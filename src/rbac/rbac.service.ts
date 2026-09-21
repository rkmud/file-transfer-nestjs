import { Injectable, Logger } from '@nestjs/common';
import { RbacStorageService } from './rbac.storage.service';
import { GrantedActions, RbacCheck, RbacConfig } from './rbac.types';

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(private storage: RbacStorageService) {}

  async getUserRoles(userId: string): Promise<string[]> {
    const config = await this.storage.getConfig();

    return [...(config.userRoles.get(userId) ?? [])];
  }

  async can({
    userId,
    roles,
    permission,
    action,
  }: RbacCheck): Promise<boolean> {
    const config = await this.storage.getConfig();
    const permissionActions = config.permissions.get(permission);

    if (!permissionActions) {
      this.logger.debug(`Unknown permission "${permission}"`);

      return false;
    }

    if (
      action &&
      permissionActions.size > 0 &&
      !permissionActions.has(action)
    ) {
      this.logger.debug(
        `Action "${action}" is not allowed for permission "${permission}"`,
      );

      return false;
    }

    const granted = roles.some((role) =>
      this.isGrantedToRole(config, role, permission, action),
    );

    if (!granted) {
      this.logger.debug(
        `User ${userId} with roles [${roles.join(', ')}] has no access to "${permission}"${action ? `@${action}` : ''}`,
      );
    }

    return granted;
  }

  async reload(): Promise<void> {
    await this.storage.reload();
  }

  invalidate(): void {
    this.storage.invalidate();
  }

  private isGrantedToRole(
    config: RbacConfig,
    role: string,
    permission: string,
    action?: string,
  ): boolean {
    const grants = config.grants.get(role);

    if (!grants?.has(permission)) {
      return false;
    }

    const grantedActions: GrantedActions = grants.get(permission) ?? null;

    if (grantedActions === null) {
      return true;
    }

    return action !== undefined && grantedActions.has(action);
  }
}
