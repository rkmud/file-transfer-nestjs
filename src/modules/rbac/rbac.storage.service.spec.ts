import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { InMemoryDatabase } from '../../../test/setup/in-memory-database';
import { FakeClock, useFakeClock } from '../../../test/setup/clock';
import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { RbacStorageService } from './rbac.storage.service';
import { RbacConfig } from './rbac.types';

const TTL_SECONDS = 30;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('RbacStorageService', () => {
  let db: InMemoryDatabase;
  let clock: FakeClock;
  let ttlSeconds: number;
  let service: RbacStorageService;
  let permissionFind: jest.SpyInstance;

  const createService = () =>
    new RbacStorageService(
      db.repo(Permission) as unknown as Repository<Permission>,
      db.repo(Grant) as unknown as Repository<Grant>,
      db.repo(UserRole) as unknown as Repository<UserRole>,
      {
        getOrThrow: jest.fn(() => ({ cacheTtlSeconds: ttlSeconds })),
      } as unknown as ConfigService,
    );

  const seedPermission = (name: string, actions: string[] = []) =>
    db.repo(Permission).seed({ name, actions })[0];
  const seedRole = (name: string) => db.repo(Role).seed({ name })[0];

  beforeEach(() => {
    clock = useFakeClock();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    db = new InMemoryDatabase();
    ttlSeconds = TTL_SECONDS;
    service = createService();
    permissionFind = jest.spyOn(db.repo(Permission), 'find');
  });

  afterEach(() => {
    clock.restore();
    jest.restoreAllMocks();
  });

  describe('building the maps', () => {
    it('indexes permissions, grants and user roles by name', async () => {
      const documents = seedPermission('documents', ['read', 'create']);
      const reports = seedPermission('reports');
      const editor = seedRole('editor');
      const viewer = seedRole('viewer');

      db.repo(Grant).seed(
        { roleId: editor.id, permissionId: documents.id, actions: ['read'] },
        { roleId: editor.id, permissionId: reports.id, actions: null },
        { roleId: viewer.id, permissionId: documents.id, actions: [] },
      );
      db.repo(UserRole).seed(
        { userId: 'user-1', roleId: editor.id },
        { userId: 'user-1', roleId: viewer.id },
        { userId: 'user-2', roleId: viewer.id },
      );

      const config = await service.getConfig();

      expect(config.permissions).toEqual(
        new Map([
          ['documents', new Set(['read', 'create'])],
          ['reports', new Set()],
        ]),
      );
      expect(config.grants.get('editor')).toEqual(
        new Map([
          ['documents', new Set(['read'])],
          ['reports', null],
        ]),
      );
      // An empty actions array means "every action", same as null.
      expect(config.grants.get('viewer')).toEqual(
        new Map([['documents', null]]),
      );
      expect(config.userRoles.get('user-1')).toEqual(['editor', 'viewer']);
      expect(config.userRoles.get('user-2')).toEqual(['viewer']);
    });

    it('treats a permission without an actions array as declaring none', async () => {
      db.repo(Permission).seed({
        name: 'legacy',
        actions: null as unknown as string[],
      });

      const config = await service.getConfig();

      expect(config.permissions.get('legacy')).toEqual(new Set());
    });

    it('skips grants and assignments whose role or permission is missing', async () => {
      const documents = seedPermission('documents');
      const editor = seedRole('editor');
      const missing = '00000000-0000-4000-8000-0000000000ff';

      db.repo(Grant).seed(
        { roleId: missing, permissionId: documents.id, actions: null },
        { roleId: editor.id, permissionId: missing, actions: null },
      );
      db.repo(UserRole).seed({ userId: 'user-1', roleId: missing });

      const config = await service.getConfig();

      expect(config.grants.size).toBe(0);
      expect(config.userRoles.size).toBe(0);
    });
  });

  describe('caching', () => {
    it('serves from cache inside the TTL and reloads once it has elapsed', async () => {
      seedPermission('documents');

      const first = await service.getConfig();

      seedPermission('reports');
      clock.advance(TTL_SECONDS * 1000 - 1);

      const cached = await service.getConfig();

      expect(cached).toBe(first);
      expect(cached.permissions.has('reports')).toBe(false);
      expect(permissionFind).toHaveBeenCalledTimes(1);

      clock.advance(1);

      const reloaded = await service.getConfig();

      expect(reloaded).not.toBe(first);
      expect(reloaded.permissions.has('reports')).toBe(true);
      expect(permissionFind).toHaveBeenCalledTimes(2);
    });

    it('reloads on every call when the TTL is disabled', async () => {
      ttlSeconds = 0;

      await service.getConfig();
      await service.getConfig();

      expect(permissionFind).toHaveBeenCalledTimes(2);
    });

    it('reloads on the next call after invalidate()', async () => {
      await service.getConfig();
      seedPermission('reports');

      service.invalidate();

      const config = await service.getConfig();

      expect(config.permissions.has('reports')).toBe(true);
      expect(permissionFind).toHaveBeenCalledTimes(2);
    });

    it('reload() rebuilds immediately and caches the result', async () => {
      await service.getConfig();
      seedPermission('reports');

      const reloaded = await service.reload();

      expect(reloaded.permissions.has('reports')).toBe(true);
      await expect(service.getConfig()).resolves.toBe(reloaded);
      expect(permissionFind).toHaveBeenCalledTimes(2);
    });

    it('shares one in-flight load between concurrent callers', async () => {
      const [a, b] = await Promise.all([
        service.getConfig(),
        service.getConfig(),
      ]);

      expect(a).toBe(b);
      expect(permissionFind).toHaveBeenCalledTimes(1);
    });

    it('does not cache a load that was invalidated while in flight', async () => {
      const stale = deferred<Permission[]>();
      const fresh = deferred<Permission[]>();

      permissionFind
        .mockReturnValueOnce(stale.promise)
        .mockReturnValueOnce(fresh.promise);

      const staleLoad = service.getConfig();

      service.invalidate();

      const freshLoad = service.getConfig();

      stale.resolve([{ name: 'stale', actions: [] } as unknown as Permission]);
      const staleConfig = await staleLoad;

      fresh.resolve([{ name: 'fresh', actions: [] } as unknown as Permission]);
      const freshConfig = await freshLoad;

      expect(staleConfig.permissions.has('stale')).toBe(true);
      expect(freshConfig.permissions.has('fresh')).toBe(true);
      // Only the fresh load is cached.
      await expect(service.getConfig()).resolves.toBe(freshConfig);
      expect(permissionFind).toHaveBeenCalledTimes(2);
    });

    it('does not cache anything when the invalidated load is the last one', async () => {
      const stale = deferred<Permission[]>();

      permissionFind.mockReturnValueOnce(stale.promise);

      const staleLoad = service.getConfig();

      service.invalidate();
      stale.resolve([]);
      await staleLoad;

      await service.getConfig();

      expect(permissionFind).toHaveBeenCalledTimes(2);
    });
  });

  describe('onModuleInit', () => {
    it('loads the configuration on startup', async () => {
      seedPermission('documents');

      await service.onModuleInit();
      const config: RbacConfig = await service.getConfig();

      expect(config.permissions.has('documents')).toBe(true);
      expect(permissionFind).toHaveBeenCalledTimes(1);
    });

    it('logs and swallows a failed startup load, then retries on demand', async () => {
      const error = new Error('db down');

      permissionFind.mockRejectedValueOnce(error);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load RBAC configuration'),
        error,
      );

      await expect(service.getConfig()).resolves.toBeDefined();
      expect(permissionFind).toHaveBeenCalledTimes(2);
    });
  });
});
