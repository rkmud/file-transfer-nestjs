import {
  FindOperator,
  getMetadataArgsStorage,
  QueryFailedError,
} from 'typeorm';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EntityClass<T = any> = new () => T;
type Row = Record<string, any>;
type Where = Row | Row[];

export interface QueryCall {
  method: string;
  args: any[];
}

export interface QueryContext<T> {
  alias: string;
  calls: QueryCall[];
  params: Record<string, any>;
  terminal: string;
  rows: T[];
  limit?: number;
  wheres: string[];
}

export type QueryResolver<T> = (context: QueryContext<T>) => any;

const TERMINALS = new Set([
  'getMany',
  'getOne',
  'getOneOrFail',
  'getRawMany',
  'getRawOne',
  'getRawAndEntities',
  'getCount',
  'getManyAndCount',
  'getExists',
  'execute',
]);

interface ColumnMeta {
  propertyName: string;
  mode: string;
  options: Row;
}

interface RelationMeta {
  propertyName: string;
  relationType: string;
  target: () => EntityClass;
  joinProperty?: string;
  onDelete?: string;
}

export interface EntityMeta {
  columns: ColumnMeta[];
  primary: string;
  generated: Set<string>;
  relations: RelationMeta[];
  uniques: string[][];
  hiddenColumns: Set<string>;
}

const inheritsFrom = (entity: EntityClass, target: unknown): boolean =>
  entity === target ||
  (typeof target === 'function' && entity.prototype instanceof target);

export const readEntityMeta = (entity: EntityClass): EntityMeta => {
  const storage = getMetadataArgsStorage();
  const columns = storage.columns
    .filter((column) => inheritsFrom(entity, column.target))
    .map((column) => ({
      propertyName: column.propertyName,
      mode: column.mode,
      options: column.options as Row,
    }));
  const columnByDbName = new Map(
    columns.map((column) => [
      (column.options.name as string | undefined) ?? column.propertyName,
      column.propertyName,
    ]),
  );
  const joinColumns = storage.joinColumns.filter((join) =>
    inheritsFrom(entity, join.target),
  );
  const relations = storage.relations
    .filter((relation) => inheritsFrom(entity, relation.target))
    .map((relation) => {
      const join = joinColumns.find(
        (candidate) => candidate.propertyName === relation.propertyName,
      );

      return {
        propertyName: relation.propertyName,
        relationType: relation.relationType,
        target: relation.type as () => EntityClass,
        joinProperty: join?.name ? columnByDbName.get(join.name) : undefined,
        onDelete: (relation.options as Row).onDelete as string | undefined,
      };
    });
  const primary =
    columns.find((column) => column.options.primary)?.propertyName ??
    storage.generations.find((g) => inheritsFrom(entity, g.target))
      ?.propertyName ??
    'id';
  const uniques: string[][] = [
    ...columns
      .filter((column) => column.options.unique)
      .map((column) => [column.propertyName]),
    ...storage.indices
      .filter((index) => inheritsFrom(entity, index.target) && index.unique)
      .map((index) =>
        Array.isArray(index.columns) ? (index.columns as string[]) : [],
      )
      .filter((cols) => cols.length > 0),
    ...storage.uniques
      .filter((unique) => inheritsFrom(entity, unique.target))
      .map((unique) =>
        Array.isArray(unique.columns) ? (unique.columns as string[]) : [],
      )
      .filter((cols) => cols.length > 0),
  ];

  return {
    columns,
    primary,
    generated: new Set(
      storage.generations
        .filter((g) => inheritsFrom(entity, g.target))
        .map((g) => g.propertyName),
    ),
    relations,
    uniques,
    hiddenColumns: new Set(
      columns
        .filter((column) => column.options.select === false)
        .map((column) => column.propertyName),
    ),
  };
};

const isOperator = (value: unknown): value is FindOperator<any> =>
  value instanceof FindOperator ||
  (typeof value === 'object' &&
    value !== null &&
    '@instanceof' in value &&
    typeof (value as Row)._type === 'string');

const comparable = (value: any): any =>
  value instanceof Date ? value.getTime() : value;

const equals = (a: any, b: any): boolean => {
  if (a instanceof Date || b instanceof Date) {
    return comparable(a) === comparable(b);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => equals(item, b[i]));
  }

  return a === b;
};

const likeToRegExp = (pattern: string, flags = ''): RegExp =>
  new RegExp(
    `^${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.')}$`,
    flags,
  );

const matchOperator = (actual: any, operator: FindOperator<any>): boolean => {
  const value = operator.value;

  switch (operator.type) {
    case 'equal':
      return equals(actual, value);
    case 'not':
      return isOperator(value)
        ? !matchOperator(actual, value)
        : !equals(actual, value);
    case 'in':
      return (value as any[]).some((candidate) => equals(actual, candidate));
    case 'any':
      return (value as any[]).some((candidate) => equals(actual, candidate));
    case 'isNull':
      return actual === null || actual === undefined;
    case 'lessThan':
      return comparable(actual) < comparable(value);
    case 'lessThanOrEqual':
      return comparable(actual) <= comparable(value);
    case 'moreThan':
      return comparable(actual) > comparable(value);
    case 'moreThanOrEqual':
      return comparable(actual) >= comparable(value);
    case 'between': {
      const [from, to] = value as [any, any];

      return (
        comparable(actual) >= comparable(from) &&
        comparable(actual) <= comparable(to)
      );
    }
    case 'like':
      return likeToRegExp(String(value)).test(String(actual ?? ''));
    case 'ilike':
      return likeToRegExp(String(value), 'i').test(String(actual ?? ''));
    case 'arrayContains':
      return (value as any[]).every((item) =>
        (actual as any[] | null)?.includes(item),
      );
    default:
      throw new Error(
        `InMemoryRepository: FindOperator "${operator.type}" is not supported`,
      );
  }
};

const clone = <T>(value: T): T => {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;

  if (value && typeof value === 'object') {
    const copy = Object.create(Object.getPrototypeOf(value));

    for (const [key, item] of Object.entries(value)) {
      copy[key] = clone(item);
    }

    return copy;
  }

  return value;
};

export interface RepositoryHost {
  repo<T>(entity: EntityClass<T>): InMemoryRepository<T>;
  nextId(): string;
  cascadeDelete(entity: EntityClass, ids: any[]): void;
}

export class InMemoryRepository<T = any> {
  readonly meta: EntityMeta;
  private rows: T[] = [];
  private resolver?: QueryResolver<T>;
  /** Every query-builder chain built against this repository, for assertions. */
  readonly queries: QueryContext<T>[] = [];

  constructor(
    readonly target: EntityClass<T>,
    private readonly host: RepositoryHost,
  ) {
    this.meta = readEntityMeta(target);
  }

  all(): T[] {
    return this.rows;
  }

  seed(...items: Partial<T>[]): T[] {
    return items.map((item) => {
      const row = this.withDefaults(this.instantiate(item));

      this.rows.push(row);

      return clone(row);
    });
  }

  clear(): void {
    this.rows = [];
    this.queries.length = 0;
  }

  setQueryResolver(resolver: QueryResolver<T> | undefined): void {
    this.resolver = resolver;
  }

  get metadata() {
    return { target: this.target, tableName: this.target.name };
  }

  get manager() {
    return {
      getRepository: <E>(entity: EntityClass<E>) => this.host.repo(entity),
      transaction: async <R>(work: (manager: any) => Promise<R>) =>
        work(this.manager),
    };
  }

  create(): T;
  create(input: Partial<T>): T;
  create(input: Partial<T>[]): T[];
  create(input?: Partial<T> | Partial<T>[]): T | T[] {
    if (Array.isArray(input)) {
      return input.map((item) => this.instantiate(item));
    }

    return this.instantiate(input ?? {});
  }

  async save<E extends Partial<T> | Partial<T>[]>(input: E): Promise<E> {
    if (Array.isArray(input)) {
      for (const item of input) this.saveOne(item);

      return input;
    }

    this.saveOne(input as Partial<T>);

    return input;
  }

  async insert(input: Partial<T> | Partial<T>[]) {
    const items = Array.isArray(input) ? input : [input];
    const identifiers = items.map((item) => {
      const row = this.withDefaults(this.instantiate(item));

      this.assertUnique(row);
      this.rows.push(row);
      Object.assign(item, clone(row));

      return { [this.meta.primary]: (row as Row)[this.meta.primary] };
    });

    return { identifiers, generatedMaps: identifiers, raw: identifiers };
  }

  async upsert(
    input: Partial<T> | Partial<T>[],
    options: string[] | { conflictPaths: string[] | Record<string, boolean> },
  ) {
    const conflict = Array.isArray(options)
      ? options
      : Array.isArray(options.conflictPaths)
        ? options.conflictPaths
        : Object.keys(options.conflictPaths).filter(
            (key) => (options.conflictPaths as Record<string, boolean>)[key],
          );
    const items = Array.isArray(input) ? input : [input];

    for (const item of items) {
      const existing = this.rows.find((row) =>
        conflict.every((key) => equals((row as Row)[key], (item as Row)[key])),
      );

      if (existing) {
        this.assign(existing, item);
        this.touch(existing);
      } else {
        this.rows.push(this.withDefaults(this.instantiate(item)));
      }
    }

    return { identifiers: [], generatedMaps: [], raw: [] };
  }

  async find(options: Row = {}): Promise<T[]> {
    let result = this.filter(options.where);

    if (options.order) {
      result = this.sort(result, options.order);
    }

    if (options.skip) result = result.slice(options.skip);
    if (options.take !== undefined) result = result.slice(0, options.take);

    return result.map((row) => this.project(row, options));
  }

  async findBy(where: Where): Promise<T[]> {
    return this.find({ where });
  }

  async findOne(options: Row): Promise<T | null> {
    const [first] = await this.find({ ...options, take: 1 });

    return first ?? null;
  }

  async findOneBy(where: Where): Promise<T | null> {
    return this.findOne({ where });
  }

  async findOneOrFail(options: Row): Promise<T> {
    const found = await this.findOne(options);

    if (!found) throw new Error(`${this.target.name} not found`);

    return found;
  }

  async findOneByOrFail(where: Where): Promise<T> {
    return this.findOneOrFail({ where });
  }

  async findAndCount(options: Row = {}): Promise<[T[], number]> {
    return [await this.find(options), this.filter(options.where).length];
  }

  async count(options: Row = {}): Promise<number> {
    return this.filter(options.where).length;
  }

  async countBy(where: Where): Promise<number> {
    return this.filter(where).length;
  }

  async exists(options: Row = {}): Promise<boolean> {
    return this.filter(options.where).length > 0;
  }

  async existsBy(where: Where): Promise<boolean> {
    return this.filter(where).length > 0;
  }

  async update(criteria: any, changes: Partial<T>) {
    const matches = this.rows.filter((row) =>
      this.matches(row, this.normalizeCriteria(criteria)),
    );

    for (const row of matches) {
      const next = { ...(row as Row), ...(changes as Row) };

      this.assertUnique(next as T, row);
      this.assign(row, changes);
      this.touch(row);
    }

    return { affected: matches.length, raw: [], generatedMaps: [] };
  }

  async increment(criteria: Where, property: string, value: number) {
    return this.step(criteria, property, value);
  }

  async decrement(criteria: Where, property: string, value: number) {
    return this.step(criteria, property, -value);
  }

  async delete(criteria: any) {
    const where = this.normalizeCriteria(criteria);
    const removed = this.rows.filter((row) => this.matches(row, where));

    this.rows = this.rows.filter((row) => !removed.includes(row));
    this.host.cascadeDelete(
      this.target,
      removed.map((row) => (row as Row)[this.meta.primary]),
    );

    return { affected: removed.length, raw: [] };
  }

  async remove<E extends T | T[]>(input: E): Promise<E> {
    const items = (Array.isArray(input) ? input : [input]) as Row[];

    await this.delete(items.map((item) => item[this.meta.primary]));

    return input;
  }

  createQueryBuilder(alias = this.target.name.toLowerCase()): any {
    const calls: QueryCall[] = [];
    const params: Record<string, any> = {};
    const collectParams = (args: any[]) => {
      for (const arg of args) {
        if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
          if (typeof arg.whereFactory === 'function') {
            arg.whereFactory(recorder(`${alias}:brackets`));
          } else if (!(arg instanceof Date)) {
            Object.assign(params, arg);
          }
        }
      }
    };
    const recorder = (scope: string): any => {
      const proxy: any = new Proxy(
        {},
        {
          get: (_target, method: string) => {
            if (method === 'then') return undefined;

            if (TERMINALS.has(method)) {
              return async () => this.resolve(alias, calls, params, method);
            }

            if (method === 'getParameters') return () => ({ ...params });

            if (method === 'getQuery' || method === 'getSql') {
              return () =>
                calls.map((c) => `${c.method}(${String(c.args[0])})`).join(' ');
            }

            return (...args: any[]) => {
              calls.push({
                method: scope === alias ? method : `${scope}.${method}`,
                args,
              });

              if (method === 'setParameter') {
                params[args[0]] = args[1];
              } else if (method === 'setParameters') {
                Object.assign(params, args[0]);
              } else {
                collectParams(args.slice(1));
                collectParams(args.slice(0, 1));
              }

              return proxy;
            };
          },
        },
      );

      return proxy;
    };

    return recorder(alias);
  }

  private resolve(
    alias: string,
    calls: QueryCall[],
    params: Record<string, any>,
    terminal: string,
  ) {
    const limitCall = calls.find(
      (call) => call.method === 'limit' || call.method === 'take',
    );
    const context: QueryContext<T> = {
      alias,
      calls,
      params,
      terminal,
      rows: this.rows.map(clone),
      limit: limitCall?.args[0],
      wheres: calls
        .filter((call) => /^(where|andWhere|orWhere)$/.test(call.method))
        .map((call) =>
          typeof call.args[0] === 'string' ? call.args[0] : '[Brackets]',
        ),
    };

    this.queries.push(context);

    if (this.resolver) return this.resolver(context);

    throw new Error(
      `InMemoryRepository<${this.target.name}>: createQueryBuilder().${terminal}() ` +
        'needs a query resolver; call setQueryResolver() in the test.',
    );
  }

  private step(criteria: Where, property: string, delta: number) {
    const matches = this.rows.filter((row) => this.matches(row, criteria));

    for (const row of matches) {
      (row as Row)[property] = Number((row as Row)[property] ?? 0) + delta;
      this.touch(row);
    }

    return { affected: matches.length, raw: [], generatedMaps: [] };
  }

  private normalizeCriteria(criteria: any): Where {
    if (Array.isArray(criteria)) {
      return criteria.map((item) =>
        typeof item === 'object' ? item : { [this.meta.primary]: item },
      );
    }

    if (criteria === null || typeof criteria !== 'object') {
      return { [this.meta.primary]: criteria };
    }

    return criteria;
  }

  private instantiate(input: Partial<T>): T {
    const entity = new this.target() as Row;

    for (const [key, value] of Object.entries(input as Row)) {
      if (value !== undefined) entity[key] = value;
    }

    return entity as T;
  }

  private assign(row: T, changes: Partial<T>): void {
    for (const [key, value] of Object.entries(changes as Row)) {
      if (value === undefined) continue;

      if (this.meta.relations.some((r) => r.propertyName === key)) {
        const relation = { [key]: value };

        this.syncJoinColumn(relation, key, row as Row);
        continue;
      }

      (row as Row)[key] = clone(value);
    }
  }

  private syncJoinColumn(source: Row, key: string, target: Row = source): void {
    const relation = this.meta.relations.find((r) => r.propertyName === key);
    const value = source[key];

    if (relation?.joinProperty && value && typeof value === 'object') {
      target[relation.joinProperty] = value.id;
    }
  }

  private withDefaults(entity: T): T {
    const row = entity as Row;
    const now = new Date();

    for (const column of this.meta.columns) {
      const key = column.propertyName;

      if (row[key] !== undefined) continue;

      if (this.meta.generated.has(key)) {
        row[key] = this.host.nextId();
      } else if (column.mode === 'createDate' || column.mode === 'updateDate') {
        row[key] = new Date(now.getTime());
      } else if ('default' in column.options) {
        const fallback = column.options.default;

        row[key] =
          typeof fallback === 'function' ? new Date(now.getTime()) : fallback;
      } else if (column.options.nullable) {
        row[key] = null;
      }
    }

    for (const relation of this.meta.relations) {
      this.syncJoinColumn(row, relation.propertyName);
    }

    const stored = clone(row) as Row;

    for (const relation of this.meta.relations)
      delete stored[relation.propertyName];

    return stored as T;
  }

  private touch(row: T): void {
    for (const column of this.meta.columns) {
      if (column.mode === 'updateDate') {
        (row as Row)[column.propertyName] = new Date();
      }
    }
  }

  private saveOne(item: Partial<T>): void {
    const id = (item as Row)[this.meta.primary];
    const existing =
      id === undefined
        ? undefined
        : this.rows.find((row) => equals((row as Row)[this.meta.primary], id));

    if (existing) {
      const candidate = { ...(existing as Row), ...(item as Row) } as T;

      this.assertUnique(candidate, existing);
      this.assign(existing, item);
      this.touch(existing);
      Object.assign(item, this.project(existing, {}));

      return;
    }

    const row = this.withDefaults(this.instantiate(item));

    this.assertUnique(row);
    this.rows.push(row);

    for (const [key, value] of Object.entries(row as Row)) {
      if (!this.meta.hiddenColumns.has(key) || key in (item as Row)) {
        (item as Row)[key] = clone(value);
      }
    }
  }

  private assertUnique(candidate: T, self?: T): void {
    for (const columns of this.meta.uniques) {
      const clash = this.rows.find(
        (row) =>
          row !== self &&
          columns.every(
            (key) =>
              (candidate as Row)[key] !== null &&
              (candidate as Row)[key] !== undefined &&
              equals((row as Row)[key], (candidate as Row)[key]),
          ),
      );

      if (clash) {
        throw new QueryFailedError(
          `INSERT INTO "${this.target.name}"`,
          [],
          Object.assign(
            new Error(
              `duplicate key value violates unique constraint (${columns.join(', ')})`,
            ),
            { code: '23505' },
          ),
        );
      }
    }
  }

  private filter(where?: Where): T[] {
    if (!where) return [...this.rows];

    return this.rows.filter((row) => this.matches(row, where));
  }

  private matches(row: T, where: Where): boolean {
    if (Array.isArray(where)) {
      return where.some((clause) => this.matches(row, clause));
    }

    return Object.entries(where).every(([key, expected]) => {
      if (expected === undefined) return true;

      const relation = this.meta.relations.find((r) => r.propertyName === key);

      if (
        relation &&
        expected &&
        typeof expected === 'object' &&
        !isOperator(expected)
      ) {
        const related = this.loadRelation(row as Row, relation);

        return (
          related !== null &&
          this.host.repo(relation.target()).matchesRow(related, expected)
        );
      }

      const actual = (row as Row)[key];

      if (isOperator(expected)) return matchOperator(actual, expected);
      if (expected === null) return actual === null || actual === undefined;

      return equals(actual, expected);
    });
  }

  matchesRow(row: any, where: Where): boolean {
    return this.matches(row, where);
  }

  private loadRelation(row: Row, relation: RelationMeta): any {
    const repo = this.host.repo(relation.target());

    if (relation.joinProperty) {
      const id = row[relation.joinProperty];

      return (
        repo
          .all()
          .find((candidate) =>
            equals((candidate as Row)[repo.meta.primary], id),
          ) ?? null
      );
    }

    return null;
  }

  private sort(rows: T[], order: Row): T[] {
    const keys = Object.entries(order);

    return [...rows].sort((a, b) => {
      for (const [key, spec] of keys) {
        let left: any = (a as Row)[key];
        let right: any = (b as Row)[key];
        let direction: any = spec;

        const relation = this.meta.relations.find(
          (r) => r.propertyName === key,
        );

        if (relation && spec && typeof spec === 'object') {
          const [[nestedKey, nestedDirection]] = Object.entries(spec as Row);

          left = this.loadRelation(a as Row, relation)?.[nestedKey];
          right = this.loadRelation(b as Row, relation)?.[nestedKey];
          direction = nestedDirection;
        }

        const desc = String(direction).toUpperCase() === 'DESC';
        const l = comparable(left);
        const r = comparable(right);

        if (l === r) continue;
        if (l === null || l === undefined) return 1;
        if (r === null || r === undefined) return -1;

        return (l < r ? -1 : 1) * (desc ? -1 : 1);
      }

      return 0;
    });
  }

  private project(row: T, options: Row): T {
    const copy = clone(row) as Row;

    if (options.select) {
      const selected = Array.isArray(options.select)
        ? options.select
        : Object.keys(options.select).filter((key) => options.select[key]);

      for (const key of Object.keys(copy)) {
        if (!selected.includes(key)) delete copy[key];
      }
    } else {
      for (const key of this.meta.hiddenColumns) delete copy[key];
    }

    if (options.relations) {
      const names = Array.isArray(options.relations)
        ? options.relations
        : Object.keys(options.relations).filter(
            (key) => options.relations[key],
          );

      for (const name of names) {
        const relation = this.meta.relations.find(
          (r) => r.propertyName === name,
        );

        if (relation) {
          const related = this.loadRelation(row as Row, relation);
          const repo = this.host.repo(relation.target());

          copy[name] = related ? repo.projectRow(related) : null;
        }
      }
    }

    return copy as T;
  }

  projectRow(row: any): any {
    return this.project(row, {});
  }
}
