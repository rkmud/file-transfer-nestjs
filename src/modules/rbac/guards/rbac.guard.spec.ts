import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiRbacAdmin } from '../decorators/api-rbac-admin.decorator';
import { RbacPermissions } from '../decorators/rbac-permissions.decorator';
import { RBAC_PERMISSIONS_KEY } from '../rbac.constants';
import { RbacService } from '../rbac.service';
import { RbacGuard } from './rbac.guard';

@RbacPermissions('reports@read')
class ClassLevelController {
  inherited() {}

  @RbacPermissions('documents@read', 'documents@create')
  overridden() {}
}

class PlainController {
  open() {}

  @RbacPermissions()
  emptyList() {}

  @RbacPermissions('documents')
  wholePermission() {}
}

const contextFor = (
  controller: new () => object,
  handler: string,
  user?: { sub?: string },
): ExecutionContext =>
  ({
    getClass: () => controller,
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('RbacGuard', () => {
  let rbac: jest.Mocked<Pick<RbacService, 'getUserRoles' | 'can'>>;
  let guard: RbacGuard;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    rbac = {
      getUserRoles: jest.fn().mockResolvedValue(['editor']),
      can: jest.fn().mockResolvedValue(true),
    };
    guard = new RbacGuard(new Reflector(), rbac as unknown as RbacService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('stores the required permissions as metadata', () => {
    expect(
      Reflect.getMetadata(
        RBAC_PERMISSIONS_KEY,
        ClassLevelController.prototype.overridden,
      ),
    ).toEqual(['documents@read', 'documents@create']);
    expect(
      Reflect.getMetadata(RBAC_PERMISSIONS_KEY, ClassLevelController),
    ).toEqual(['reports@read']);
  });

  it.each([
    ['no metadata', 'open'],
    ['an empty permission list', 'emptyList'],
  ])(
    'lets the request through when the handler has %s',
    async (_l, handler) => {
      await expect(
        guard.canActivate(contextFor(PlainController, handler)),
      ).resolves.toBe(true);
      expect(rbac.can).not.toHaveBeenCalled();
    },
  );

  it('checks every handler-level permission, split into resource and action', async () => {
    await expect(
      guard.canActivate(
        contextFor(ClassLevelController, 'overridden', { sub: 'user-1' }),
      ),
    ).resolves.toBe(true);

    expect(rbac.getUserRoles).toHaveBeenCalledWith('user-1');
    expect(rbac.can.mock.calls).toEqual([
      [
        {
          userId: 'user-1',
          roles: ['editor'],
          permission: 'documents',
          action: 'read',
        },
      ],
      [
        {
          userId: 'user-1',
          roles: ['editor'],
          permission: 'documents',
          action: 'create',
        },
      ],
    ]);
  });

  it('falls back to class-level metadata', async () => {
    await guard.canActivate(
      contextFor(ClassLevelController, 'inherited', { sub: 'user-1' }),
    );

    expect(rbac.can).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'reports', action: 'read' }),
    );
  });

  it('passes no action for a bare resource requirement', async () => {
    await guard.canActivate(
      contextFor(PlainController, 'wholePermission', { sub: 'user-1' }),
    );

    expect(rbac.can).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'documents', action: undefined }),
    );
  });

  it.each([
    ['request.user is absent', undefined],
    ['request.user has no sub', {}],
  ])(
    'denies with 401 when %s (AccessTokenGuard must run first)',
    async (_l, user) => {
      await expect(
        guard.canActivate(contextFor(ClassLevelController, 'overridden', user)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(rbac.getUserRoles).not.toHaveBeenCalled();
    },
  );

  it('denies with 403 and stops at the first missing permission', async () => {
    rbac.can.mockResolvedValueOnce(false);

    await expect(
      guard.canActivate(
        contextFor(ClassLevelController, 'overridden', { sub: 'user-1' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(rbac.can).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Access denied: actorUserId=user-1 permission=documents@read status=403',
    );
  });
});

// Metadata keys of @nestjs/swagger (not exported from its public entry point).
const API_SECURITY = 'swagger/apiSecurity';
const API_RESPONSE = 'swagger/apiResponse';

describe('ApiRbacAdmin', () => {
  it('documents cookie auth and the 401/403 responses', () => {
    @ApiRbacAdmin()
    class Documented {}

    expect(Reflect.getMetadata(API_SECURITY, Documented)).toEqual([
      { 'access-token': [] },
    ]);
    expect(Object.keys(Reflect.getMetadata(API_RESPONSE, Documented))).toEqual(
      expect.arrayContaining(['401', '403']),
    );
  });
});
