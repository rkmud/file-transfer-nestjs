import { Logger } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RbacStorageService } from './rbac.storage.service';
import { RbacConfig } from './rbac.types';

const buildConfig = (): RbacConfig => ({
  permissions: new Map([
    ['documents', new Set(['read', 'create', 'delete'])],
    ['reports', new Set<string>()],
    ['billing', new Set(['read', 'pay'])],
  ]),
  grants: new Map([
    [
      'editor',
      new Map([
        ['documents', new Set(['read', 'create'])],
        ['reports', null],
      ]),
    ],
    ['accountant', new Map([['billing', null]])],
  ]),
  userRoles: new Map([['user-1', ['editor', 'accountant']]]),
});

describe('RbacService', () => {
  let storage: jest.Mocked<
    Pick<RbacStorageService, 'getConfig' | 'reload' | 'invalidate'>
  >;
  let service: RbacService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    storage = {
      getConfig: jest.fn().mockResolvedValue(buildConfig()),
      reload: jest.fn().mockResolvedValue(buildConfig()),
      invalidate: jest.fn(),
    };
    service = new RbacService(storage as unknown as RbacStorageService);
  });

  afterEach(() => jest.restoreAllMocks());

  const can = (roles: string[], permission: string, action?: string) =>
    service.can({ userId: 'user-1', roles, permission, action });

  describe('getUserRoles', () => {
    it('returns a copy of the roles assigned to the user', async () => {
      const roles = await service.getUserRoles('user-1');

      expect(roles).toEqual(['editor', 'accountant']);

      roles.push('mutated');

      await expect(service.getUserRoles('user-1')).resolves.toEqual([
        'editor',
        'accountant',
      ]);
    });

    it('returns an empty list for a user without roles', async () => {
      await expect(service.getUserRoles('nobody')).resolves.toEqual([]);
    });
  });

  describe('can()', () => {
    it('allows an action listed in an explicit grant subset', async () => {
      await expect(can(['editor'], 'documents', 'read')).resolves.toBe(true);
      await expect(can(['editor'], 'documents', 'create')).resolves.toBe(true);
    });

    it('denies a declared action outside the explicit grant subset', async () => {
      await expect(can(['editor'], 'documents', 'delete')).resolves.toBe(false);
    });

    it('denies an explicit-subset grant when no action is requested', async () => {
      await expect(can(['editor'], 'documents')).resolves.toBe(false);
    });

    it('allows every declared action for a grant with an empty actions list', async () => {
      await expect(can(['accountant'], 'billing', 'read')).resolves.toBe(true);
      await expect(can(['accountant'], 'billing', 'pay')).resolves.toBe(true);
      await expect(can(['accountant'], 'billing')).resolves.toBe(true);
    });

    it('allows any action on a permission that declares no actions', async () => {
      await expect(can(['editor'], 'reports', 'anything')).resolves.toBe(true);
    });

    it('denies an action the permission does not declare, even for a whole grant', async () => {
      await expect(can(['accountant'], 'billing', 'refund')).resolves.toBe(
        false,
      );
    });

    it('denies when none of the roles holds a grant for the permission', async () => {
      await expect(can(['accountant'], 'documents', 'read')).resolves.toBe(
        false,
      );
      await expect(can(['ghost-role'], 'documents', 'read')).resolves.toBe(
        false,
      );
      await expect(can([], 'documents', 'read')).resolves.toBe(false);
    });

    it('denies an unknown resource', async () => {
      await expect(can(['editor'], 'unknown', 'read')).resolves.toBe(false);
    });

    it('grants when any one of several roles matches', async () => {
      await expect(
        can(['ghost-role', 'accountant'], 'billing', 'pay'),
      ).resolves.toBe(true);
    });
  });

  it('delegates reload() and invalidate() to the storage', async () => {
    await service.reload();
    service.invalidate();

    expect(storage.reload).toHaveBeenCalledTimes(1);
    expect(storage.invalidate).toHaveBeenCalledTimes(1);
  });
});
