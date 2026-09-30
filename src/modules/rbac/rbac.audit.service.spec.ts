import {
  ConflictException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RbacAuditService } from './rbac.audit.service';

describe('RbacAuditService', () => {
  let audit: RbacAuditService;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    audit = new RbacAuditService();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('track()', () => {
    it('logs a successful mutation with the id of the created entity', async () => {
      const result = await audit.track(
        { actorUserId: 'admin-1', operation: 'create', entity: 'role' },
        HttpStatus.CREATED,
        async () => ({ id: 'role-1', name: 'editor' }),
      );

      expect(result).toEqual({ id: 'role-1', name: 'editor' });
      expect(log).toHaveBeenCalledWith(
        'actorUserId=admin-1 operation=create entity=role entityId=role-1 status=201',
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('keeps an explicit entityId over the one in the result', async () => {
      await audit.track(
        {
          actorUserId: 'admin-1',
          operation: 'update',
          entity: 'permission',
          entityId: 'perm-1',
        },
        HttpStatus.OK,
        async () => ({ id: 'other' }),
      );

      expect(log).toHaveBeenCalledWith(
        'actorUserId=admin-1 operation=update entity=permission entityId=perm-1 status=200',
      );
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a primitive', 'text'],
      ['an object with a non-string id', { id: 42 }],
    ])(
      'omits entityId when the result is %s',
      async (_label, value: unknown) => {
        await audit.track(
          { actorUserId: 'admin-1', operation: 'delete', entity: 'grant' },
          HttpStatus.NO_CONTENT,
          async () => value,
        );

        expect(log).toHaveBeenCalledWith(
          'actorUserId=admin-1 operation=delete entity=grant status=204',
        );
      },
    );

    it('logs a rejected (4xx) mutation as a warning and rethrows', async () => {
      const error = new ConflictException('duplicate');

      await expect(
        audit.track(
          { actorUserId: 'admin-1', operation: 'create', entity: 'role' },
          HttpStatus.CREATED,
          () => Promise.reject(error),
        ),
      ).rejects.toBe(error);

      expect(warn).toHaveBeenCalledWith(
        'actorUserId=admin-1 operation=create entity=role status=409',
      );
      expect(log).not.toHaveBeenCalled();
    });

    it('includes the entityId of a rejected mutation when known', async () => {
      await expect(
        audit.track(
          {
            actorUserId: 'admin-1',
            operation: 'delete',
            entity: 'userRole',
            entityId: 'user-1:role-1',
          },
          HttpStatus.NO_CONTENT,
          () => Promise.reject(new NotFoundException()),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(warn).toHaveBeenCalledWith(
        'actorUserId=admin-1 operation=delete entity=userRole entityId=user-1:role-1 status=404',
      );
    });

    it('records a non-HTTP error as 500', async () => {
      await expect(
        audit.track(
          { actorUserId: 'admin-1', operation: 'update', entity: 'role' },
          HttpStatus.OK,
          () => Promise.reject(new Error('boom')),
        ),
      ).rejects.toThrow('boom');

      expect(warn).toHaveBeenCalledWith(
        'actorUserId=admin-1 operation=update entity=role status=500',
      );
    });
  });
});
