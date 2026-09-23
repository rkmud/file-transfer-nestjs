import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '@/common/auth-token/auth-token.types';
import { RBAC_ACTION_SEPARATOR, RBAC_PERMISSIONS_KEY } from '../rbac.constants';
import { RbacService } from '../rbac.service';

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private reflector: Reflector,
    private rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<string[]>(RBAC_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!user?.sub) {
      throw new UnauthorizedException('Unauthorized');
    }

    const roles = await this.rbacService.getUserRoles(user.sub);

    for (const requiredPermission of required) {
      const [permission, action] = requiredPermission.split(
        RBAC_ACTION_SEPARATOR,
      );

      const granted = await this.rbacService.can({
        userId: user.sub,
        roles,
        permission,
        action,
      });

      if (!granted) {
        this.logger.warn(
          `Access denied: actorUserId=${user.sub} permission=${requiredPermission} status=403`,
        );

        throw new ForbiddenException('Forbidden resource');
      }
    }

    return true;
  }
}
