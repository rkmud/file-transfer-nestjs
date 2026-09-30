import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ObjectLiteral, QueryFailedError, Repository } from 'typeorm';
import { UsersService } from '@/modules/users/users.service';
import { InMemoryDatabase } from '../../../../test/setup/in-memory-database';
import { Grant } from '../entities/grant.entity';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RbacAuditService } from '../rbac.audit.service';
import { RbacService } from '../rbac.service';
import { RbacGrantsService } from './rbac-grants.service';
import { RbacPermissionsService } from './rbac-permissions.service';
import { RbacRolesService } from './rbac-roles.service';
import { RbacUserRolesService } from './rbac-user-roles.service';

/**
 * The HTTP happy paths and 4xx cases of these services are covered by
 * test/integration/rbac.e2e-spec.ts. This spec pins what the API cannot
 * reach deterministically: a unique-constraint race at `save()` (another
 * request inserted the same row after the pre-check), and non-constraint
 * errors being propagated untouched.
 */

const uniqueViolation = () =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505' }),
  );

const ACTOR = 'admin-1';

describe('RBAC admin services', () => {
  let db: InMemoryDatabase;
  let rbac: jest.Mocked<Pick<RbacService, 'reload'>>;
  let audit: RbacAuditService;
  let warn: jest.SpyInstance;

  const repo = <T extends ObjectLiteral>(entity: new () => T) =>
    db.repo(entity) as unknown as Repository<T>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    db = new InMemoryDatabase();
    rbac = { reload: jest.fn().mockResolvedValue(undefined) };
    audit = new RbacAuditService();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('RbacRolesService', () => {
    let service: RbacRolesService;

    beforeEach(() => {
      service = new RbacRolesService(
        repo(Role),
        repo(Grant),
        repo(UserRole),
        rbac as unknown as RbacService,
        audit,
      );
    });

    it('findByName returns the role or throws 404', async () => {
      const [role] = db.repo(Role).seed({ name: 'editor' });

      await expect(service.findByName('editor')).resolves.toEqual(
        expect.objectContaining({ id: role.id }),
      );
      await expect(service.findByName('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps a unique violation at save to 409 and audits it', async () => {
      jest
        .spyOn(db.repo(Role), 'save')
        .mockRejectedValueOnce(uniqueViolation());

      await expect(
        service.create(ACTOR, { name: 'editor' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(warn).toHaveBeenCalledWith(
        `actorUserId=${ACTOR} operation=create entity=role status=409`,
      );
      expect(rbac.reload).not.toHaveBeenCalled();
    });

    it('rethrows any other save error', async () => {
      const error = new Error('connection lost');

      jest.spyOn(db.repo(Role), 'save').mockRejectedValueOnce(error);

      await expect(service.create(ACTOR, { name: 'editor' })).rejects.toBe(
        error,
      );
    });

    it('reloads RBAC after every successful mutation', async () => {
      const role = await service.create(ACTOR, { name: 'editor' });

      await service.update(ACTOR, role.id, { description: 'x' });
      await service.remove(ACTOR, role.id);

      expect(rbac.reload).toHaveBeenCalledTimes(3);
    });
  });

  describe('RbacPermissionsService', () => {
    let service: RbacPermissionsService;

    beforeEach(() => {
      service = new RbacPermissionsService(
        repo(Permission),
        repo(Grant),
        rbac as unknown as RbacService,
        audit,
      );
    });

    it('maps a unique violation at save to 409', async () => {
      jest
        .spyOn(db.repo(Permission), 'save')
        .mockRejectedValueOnce(uniqueViolation());

      await expect(
        service.create(ACTOR, { name: 'documents' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows any other save error', async () => {
      const error = new Error('connection lost');

      jest.spyOn(db.repo(Permission), 'save').mockRejectedValueOnce(error);

      await expect(service.create(ACTOR, { name: 'documents' })).rejects.toBe(
        error,
      );
    });
  });

  describe('RbacGrantsService', () => {
    let service: RbacGrantsService;
    let role: Role;
    let permission: Permission;

    beforeEach(() => {
      service = new RbacGrantsService(
        repo(Grant),
        repo(Role),
        repo(Permission),
        rbac as unknown as RbacService,
        audit,
      );
      [role] = db.repo(Role).seed({ name: 'editor' });
      [permission] = db
        .repo(Permission)
        .seed({ name: 'documents', actions: ['read'] });
    });

    it('maps a unique violation at save to 409', async () => {
      jest
        .spyOn(db.repo(Grant), 'save')
        .mockRejectedValueOnce(uniqueViolation());

      await expect(
        service.create(ACTOR, {
          roleId: role.id,
          permissionId: permission.id,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows any other save error', async () => {
      const error = new Error('connection lost');

      jest.spyOn(db.repo(Grant), 'save').mockRejectedValueOnce(error);

      await expect(
        service.create(ACTOR, {
          roleId: role.id,
          permissionId: permission.id,
        }),
      ).rejects.toBe(error);
    });

    it('keeps the actions of a grant when only its role changes', async () => {
      const [other] = db.repo(Role).seed({ name: 'reviewer' });
      const grant = await service.create(ACTOR, {
        roleId: role.id,
        permissionId: permission.id,
        actions: ['read'],
      });

      const updated = await service.update(ACTOR, grant.id, {
        roleId: other.id,
      });

      expect(updated).toEqual(
        expect.objectContaining({ roleName: 'reviewer', actions: ['read'] }),
      );
    });

    it('keeps a whole-permission grant whole when its permission changes', async () => {
      const [reports] = db
        .repo(Permission)
        .seed({ name: 'reports', actions: [] });
      const grant = await service.create(ACTOR, {
        roleId: role.id,
        permissionId: permission.id,
      });

      const updated = await service.update(ACTOR, grant.id, {
        permissionId: reports.id,
      });

      expect(updated.actions).toBeNull();
    });
  });

  describe('RbacUserRolesService', () => {
    let service: RbacUserRolesService;
    let role: Role;

    beforeEach(() => {
      const users = {
        getUserById: jest.fn(async (id: string) =>
          id === 'user-1' ? { id } : null,
        ),
      };

      service = new RbacUserRolesService(
        repo(UserRole),
        repo(Role),
        users as unknown as UsersService,
        rbac as unknown as RbacService,
        audit,
      );
      [role] = db.repo(Role).seed({ name: 'editor' });
    });

    it('maps a unique violation at save to 409 with the composite entity id', async () => {
      jest
        .spyOn(db.repo(UserRole), 'save')
        .mockRejectedValueOnce(uniqueViolation());

      await expect(
        service.assign(ACTOR, 'user-1', { roleId: role.id }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(warn).toHaveBeenCalledWith(
        `actorUserId=${ACTOR} operation=create entity=userRole entityId=user-1:${role.id} status=409`,
      );
    });

    it('rethrows any other save error', async () => {
      const error = new Error('connection lost');

      jest.spyOn(db.repo(UserRole), 'save').mockRejectedValueOnce(error);

      await expect(
        service.assign(ACTOR, 'user-1', { roleId: role.id }),
      ).rejects.toBe(error);
    });
  });
});
