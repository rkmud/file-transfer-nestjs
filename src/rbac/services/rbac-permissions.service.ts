import {
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePermissionDto } from '../dto/create-permission.dto';
import { UpdatePermissionDto } from '../dto/update-permission.dto';
import { Grant } from '../entities/grant.entity';
import { Permission } from '../entities/permission.entity';
import { RbacAuditService } from '../rbac.audit.service';
import { RbacService } from '../rbac.service';
import { isUniqueViolation } from '../rbac.utils';

@Injectable()
export class RbacPermissionsService {
  constructor(
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    @InjectRepository(Grant)
    private grantRepository: Repository<Grant>,
    private rbacService: RbacService,
    private audit: RbacAuditService,
  ) {}

  findAll(): Promise<Permission[]> {
    return this.permissionRepository.find({ order: { name: 'ASC' } });
  }

  create(actorUserId: string, dto: CreatePermissionDto): Promise<Permission> {
    return this.audit.track(
      { actorUserId, operation: 'create', entity: 'permission' },
      HttpStatus.CREATED,
      async () => {
        await this.ensureNameIsFree(dto.name);

        const permission = await this.save(
          this.permissionRepository.create({
            name: dto.name,
            actions: dto.actions ?? [],
          }),
        );

        await this.rbacService.reload();

        return permission;
      },
    );
  }

  update(
    actorUserId: string,
    id: string,
    dto: UpdatePermissionDto,
  ): Promise<Permission> {
    return this.audit.track(
      { actorUserId, operation: 'update', entity: 'permission', entityId: id },
      HttpStatus.OK,
      async () => {
        const permission = await this.requirePermission(id);

        if (dto.name !== undefined && dto.name !== permission.name) {
          await this.ensureNameIsFree(dto.name);
          permission.name = dto.name;
        }

        if (dto.actions !== undefined) {
          await this.ensureActionsStayGranted(permission, dto.actions);
          permission.actions = dto.actions;
        }

        const updated = await this.save(permission);

        await this.rbacService.reload();

        return updated;
      },
    );
  }

  remove(actorUserId: string, id: string): Promise<void> {
    return this.audit.track(
      { actorUserId, operation: 'delete', entity: 'permission', entityId: id },
      HttpStatus.NO_CONTENT,
      async () => {
        const permission = await this.requirePermission(id);

        await this.ensurePermissionIsUnused(permission);
        await this.permissionRepository.delete({ id: permission.id });
        await this.rbacService.reload();
      },
    );
  }

  private async requirePermission(id: string): Promise<Permission> {
    const permission = await this.permissionRepository.findOne({
      where: { id },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    return permission;
  }

  private async ensureNameIsFree(name: string): Promise<void> {
    const existing = await this.permissionRepository.findOne({
      where: { name },
    });

    if (existing) {
      throw new ConflictException(`Permission "${name}" already exists`);
    }
  }

  private async ensurePermissionIsUnused(
    permission: Permission,
  ): Promise<void> {
    const grants = await this.grantRepository.countBy({
      permissionId: permission.id,
    });

    if (grants > 0) {
      throw new ConflictException(
        `Permission "${permission.name}" cannot be deleted: ${grants} grant(s) reference it`,
      );
    }
  }

  /**
   * Narrowing the action list would leave grants pointing at actions the
   * permission no longer declares, which silently revokes access.
   */
  private async ensureActionsStayGranted(
    permission: Permission,
    actions: string[],
  ): Promise<void> {
    if (actions.length === 0) {
      return;
    }

    const grants = await this.grantRepository.findBy({
      permissionId: permission.id,
    });

    const allowed = new Set(actions);
    const orphaned = [
      ...new Set(
        grants.flatMap((grant) =>
          (grant.actions ?? []).filter((action) => !allowed.has(action)),
        ),
      ),
    ];

    if (orphaned.length > 0) {
      throw new ConflictException(
        `Actions [${orphaned.join(', ')}] are still used by grants of permission "${permission.name}"`,
      );
    }
  }

  private async save(permission: Permission): Promise<Permission> {
    try {
      return await this.permissionRepository.save(permission);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Permission "${permission.name}" already exists`,
        );
      }

      throw error;
    }
  }
}
