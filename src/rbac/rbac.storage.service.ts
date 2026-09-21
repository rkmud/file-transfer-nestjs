import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RbacConfigOptions } from '@/config/configuration';
import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { UserRole } from './entities/user-role.entity';
import { GrantedActions, RbacConfig } from './rbac.types';

@Injectable()
export class RbacStorageService implements OnModuleInit {
  private readonly logger = new Logger(RbacStorageService.name);

  private config: RbacConfig | null = null;
  private loadedAt = 0;
  private loading: Promise<RbacConfig> | null = null;

  constructor(
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(Grant)
    private grantRepository: Repository<Grant>,
    @InjectRepository(UserRole)
    private userRoleRepository: Repository<UserRole>,
    private configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reload();
    } catch (error) {
      this.logger.error(
        'Failed to load RBAC configuration on startup, access is denied until the next successful load',
        error,
      );
    }
  }

  async getConfig(): Promise<RbacConfig> {
    if (this.config && !this.isStale()) {
      return this.config;
    }

    return this.load();
  }

  invalidate(): void {
    this.config = null;
    this.logger.log('RBAC cache invalidated, configuration will be reloaded');
  }

  async reload(): Promise<RbacConfig> {
    this.config = null;

    return this.load();
  }

  /**
   * Roles, permissions and grants can also be changed straight in the database
   * (or by another instance of the application), so a cached configuration is
   * only trusted for the configured TTL. A TTL of 0 disables caching.
   */
  private isStale(): boolean {
    const ttlSeconds = this.getCacheTtlSeconds();

    if (ttlSeconds <= 0) {
      return true;
    }

    return Date.now() - this.loadedAt >= ttlSeconds * 1000;
  }

  private getCacheTtlSeconds(): number {
    const { cacheTtlSeconds } =
      this.configService.getOrThrow<RbacConfigOptions>('rbac');

    return cacheTtlSeconds;
  }

  private load(): Promise<RbacConfig> {
    if (!this.loading) {
      this.loading = this.build()
        .then((config) => {
          this.config = config;
          this.loadedAt = Date.now();

          return config;
        })
        .finally(() => {
          this.loading = null;
        });
    }

    return this.loading;
  }

  private async build(): Promise<RbacConfig> {
    const [permissions, grants, userRoles] = await Promise.all([
      this.permissionRepository.find(),
      this.grantRepository.find({
        relations: { role: true, permission: true },
      }),
      this.userRoleRepository.find({ relations: { role: true } }),
    ]);

    const config: RbacConfig = {
      permissions: new Map(
        permissions.map((permission) => [
          permission.name,
          new Set(permission.actions ?? []),
        ]),
      ),
      grants: this.buildGrants(grants),
      userRoles: this.buildUserRoles(userRoles),
    };

    this.logger.log(
      `RBAC configuration loaded: ${config.permissions.size} permissions, ${grants.length} grants, ${config.userRoles.size} users with roles`,
    );

    return config;
  }

  private buildGrants(
    grants: Grant[],
  ): ReadonlyMap<string, ReadonlyMap<string, GrantedActions>> {
    const byRole = new Map<string, Map<string, GrantedActions>>();

    for (const grant of grants) {
      if (!grant.role || !grant.permission) {
        continue;
      }

      const permissions =
        byRole.get(grant.role.name) ?? new Map<string, GrantedActions>();

      permissions.set(
        grant.permission.name,
        grant.actions?.length ? new Set(grant.actions) : null,
      );
      byRole.set(grant.role.name, permissions);
    }

    return byRole;
  }

  private buildUserRoles(
    userRoles: UserRole[],
  ): ReadonlyMap<string, readonly string[]> {
    const byUser = new Map<string, string[]>();

    for (const userRole of userRoles) {
      if (!userRole.role) {
        continue;
      }

      const roles = byUser.get(userRole.userId) ?? [];

      roles.push(userRole.role.name);
      byUser.set(userRole.userId, roles);
    }

    return byUser;
  }
}
