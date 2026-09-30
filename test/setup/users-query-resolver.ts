import { User } from '@/modules/users/users.entity';
import { InMemoryRepository, QueryContext } from './in-memory-repository';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SORT_VALUE_ALIAS = 'list_sort_value';

const PROPERTY_TO_COLUMN: Record<string, string> = {
  createdAt: 'created_at',
  lastLoginAt: 'last_login_at',
  email: 'email',
};

const toMicros = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().replace('Z', '000Z') : null;

const ilike = (pattern: string): RegExp => {
  let source = '';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (char === '\\' && i + 1 < pattern.length) {
      i += 1;
      source += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (char === '%') {
      source += '.*';
    } else if (char === '_') {
      source += '.';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(`^${source}$`, 'is');
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const usersQueryResolver = (context: QueryContext<User>) => {
  const orderBy = context.calls.find((call) => call.method === 'orderBy');

  if (!orderBy || context.terminal !== 'getRawAndEntities') {
    throw new Error(
      `usersQueryResolver: unsupported query (${context.terminal})`,
    );
  }

  const property = String(orderBy.args[0]).replace(/^user\./, '');
  const column = PROPERTY_TO_COLUMN[property];
  const desc = orderBy.args[1] === 'DESC';
  const timestamp = column !== 'email';
  const sortValue = (row: User): string | null =>
    timestamp
      ? toMicros((row as any)[property])
      : ((row as any)[property] as string);

  const now = Date.now();
  const wheres = context.wheres.join(' ');
  const { pattern, searchId, afterValue, afterId } = context.params;
  let rows = context.rows;

  if (wheres.includes('"locked_until" > now()')) {
    rows = rows.filter(
      (row) => row.lockedUntil !== null && row.lockedUntil.getTime() > now,
    );
  } else if (wheres.includes('"locked_until" IS NULL OR')) {
    rows = rows.filter(
      (row) => row.lockedUntil === null || row.lockedUntil.getTime() <= now,
    );
  }

  if (pattern !== undefined) {
    const regex = ilike(pattern);

    rows = rows.filter(
      (row) =>
        regex.test(row.email) ||
        (row.firstName !== null && regex.test(row.firstName)) ||
        (row.lastName !== null && regex.test(row.lastName)) ||
        (searchId !== undefined && row.id === searchId),
    );
  }

  const idAfter = (row: User) =>
    desc ? compare(row.id, afterId) < 0 : compare(row.id, afterId) > 0;

  if (afterId !== undefined) {
    rows = rows.filter((row) => {
      const value = sortValue(row);

      if (afterValue === null) return value === null && idAfter(row);
      if (value === null) return true;

      const order = compare(value, afterValue);

      return (desc ? order < 0 : order > 0) || (order === 0 && idAfter(row));
    });
  }

  rows = [...rows].sort((a, b) => {
    const left = sortValue(a);
    const right = sortValue(b);

    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;

      return compare(left, right) * (desc ? -1 : 1);
    }

    return compare(a.id, b.id) * (desc ? -1 : 1);
  });

  if (context.limit !== undefined) rows = rows.slice(0, context.limit);

  return {
    entities: rows.map((row) => {
      const entity = Object.assign(new User(), row);

      delete (entity as Partial<User>).password;

      return entity;
    }),
    raw: rows.map((row) => ({
      user_id: row.id,
      [SORT_VALUE_ALIAS]: sortValue(row),
    })),
  };
};

export const installUsersQueryResolver = (
  repo: InMemoryRepository<User>,
): void => repo.setQueryResolver(usersQueryResolver);
