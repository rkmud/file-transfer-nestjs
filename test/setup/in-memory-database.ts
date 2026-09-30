import { DataSource } from 'typeorm';
import {
  EntityClass,
  InMemoryRepository,
  RepositoryHost,
} from './in-memory-repository';

/* eslint-disable @typescript-eslint/no-explicit-any */
export class InMemoryDatabase implements RepositoryHost {
  private readonly repos = new Map<EntityClass, InMemoryRepository>();
  private sequence = 0;

  query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>(async () => [
    { '?column?': 1 },
  ]);

  repo<T>(entity: EntityClass<T>): InMemoryRepository<T> {
    let repo = this.repos.get(entity);

    if (!repo) {
      repo = new InMemoryRepository(entity, this);
      this.repos.set(entity, repo);
    }

    return repo as InMemoryRepository<T>;
  }

  nextId(): string {
    this.sequence += 1;

    return `00000000-0000-4000-8000-${this.sequence.toString(16).padStart(12, '0')}`;
  }

  cascadeDelete(entity: EntityClass, ids: any[]): void {
    if (ids.length === 0) return;

    for (const repo of this.repos.values()) {
      for (const relation of repo.meta.relations) {
        if (
          relation.onDelete === 'CASCADE' &&
          relation.joinProperty &&
          relation.target() === entity
        ) {
          const joinProperty = relation.joinProperty;

          void repo.delete(
            repo
              .all()
              .filter((row: any) => ids.includes(row[joinProperty]))
              .map((row: any) => row[repo.meta.primary]),
          );
        }
      }
    }
  }

  reset(): void {
    for (const repo of this.repos.values()) {
      repo.clear();
      repo.setQueryResolver(undefined);
    }

    this.sequence = 0;
    this.query.mockReset();
    this.query.mockImplementation(async () => [{ '?column?': 1 }]);
  }

  asDataSource(): DataSource {
    const manager = {
      getRepository: (entity: EntityClass) => this.repo(entity),
      query: (sql: string, params?: unknown[]) => this.query(sql, params),
      transaction: async (work: (m: unknown) => Promise<unknown>) =>
        work(manager),
    };

    return {
      isInitialized: true,
      options: { type: 'postgres' },
      entityMetadatas: [],
      manager,
      getRepository: (entity: EntityClass) => this.repo(entity),
      query: (sql: string, params?: unknown[]) => this.query(sql, params),
      transaction: manager.transaction,
      destroy: async () => undefined,
    } as unknown as DataSource;
  }
}
