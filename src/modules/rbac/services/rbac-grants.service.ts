import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CreateGrantDto } from '../dto/create-grant.dto';
import { UpdateGrantDto } from '../dto/update-grant.dto';
import { Grant } from '../entities/grant.entity';
import { Permission } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { RbacAuditService } from '../rbac.audit.service';
import { RbacService } from '../rbac.service';
import { GrantView } from '../rbac.types';
import { isUniqueViolation } from '../rbac.utils';

@Injectable()
export class RbacGrantsService {
  constructor(
    @InjectRepository(Grant)
    private grantRepository: Repository<Grant>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private permissionRepository: Repository<Permission>,
    private rbacService: RbacService,
    private audit: RbacAuditService,
  ) {}

  async findAll(): Promise<GrantView[]> {
    const grants = await this.grantRepository.find({
      relations: { role: true, permission: true },
      order: { role: { name: 'ASC' }, permission: { name: 'ASC' } },
    });

    return grants.map((grant) => this.toView(grant));
  }

  create(actorUserId: string, dto: CreateGrantDto): Promise<GrantView> {
    return this.audit.track(
      { actorUserId, operation: 'create', entity: 'grant' },
      HttpStatus.CREATED,
      async () => {
        const { role, permission } = await this.requireRelations(
          dto.roleId,
          dto.permissionId,
        );

        await this.ensureNotDuplicated(role, permission);

        const actions = this.resolveActions(permission, dto.actions);
        const grant = await this.save(
          this.grantRepository.create({
            roleId: role.id,
            permissionId: permission.id,
            actions,
          }),
          role,
          permission,
        );

        await this.rbacService.reload();

        return this.toView({ ...grant, role, permission });
      },
    );
  }

  update(
    actorUserId: string,
    id: string,
    dto: UpdateGrantDto,
  ): Promise<GrantView> {
    return this.audit.track(
      { actorUserId, operation: 'update', entity: 'grant', entityId: id },
      HttpStatus.OK,
      async () => {
        const grant = await this.requireGrant(id);
        const { role, permission } = await this.requireRelations(
          dto.roleId ?? grant.roleId,
          dto.permissionId ?? grant.permissionId,
        );

        const roleChanged = role.id !== grant.roleId;
        const permissionChanged = permission.id !== grant.permissionId;

        if (roleChanged || permissionChanged) {
          await this.ensureNotDuplicated(role, permission, grant.id);
        }

        if (dto.actions !== undefined || permissionChanged) {
          grant.actions = this.resolveActions(
            permission,
            dto.actions ?? grant.actions ?? undefined,
          );
        }

        grant.roleId = role.id;
        grant.permissionId = permission.id;

        const updated = await this.save(grant, role, permission);

        await this.rbacService.reload();

        return this.toView({ ...updated, role, permission });
      },
    );
  }

  remove(actorUserId: string, id: string): Promise<void> {
    return this.audit.track(
      { actorUserId, operation: 'delete', entity: 'grant', entityId: id },
      HttpStatus.NO_CONTENT,
      async () => {
        const grant = await this.requireGrant(id);

        await this.grantRepository.delete({ id: grant.id });
        await this.rbacService.reload();
      },
    );
  }

  private async requireGrant(id: string): Promise<Grant> {
    const grant = await this.grantRepository.findOne({ where: { id } });

    if (!grant) {
      throw new NotFoundException('Grant not found');
    }

    return grant;
  }

  private async requireRelations(
    roleId: string,
    permissionId: string,
  ): Promise<{ role: Role; permission: Permission }> {
    const [role, permission] = await Promise.all([
      this.roleRepository.findOne({ where: { id: roleId } }),
      this.permissionRepository.findOne({ where: { id: permissionId } }),
    ]);

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    return { role, permission };
  }

  private async ensureNotDuplicated(
    role: Role,
    permission: Permission,
    excludeGrantId?: string,
  ): Promise<void> {
    const existing = await this.grantRepository.findOne({
      where: {
        roleId: role.id,
        permissionId: permission.id,
        ...(excludeGrantId ? { id: Not(excludeGrantId) } : {}),
      },
    });

    if (existing) {
      throw new ConflictException(
        `Role "${role.name}" already has a grant for permission "${permission.name}"`,
      );
    }
  }

  /**
   * An empty action list means "every action of the permission", which is
   * stored as NULL; otherwise the actions must be declared by the permission.
   */
  private resolveActions(
    permission: Permission,
    actions?: string[],
  ): string[] | null {
    if (!actions?.length) {
      return null;
    }

    if (permission.actions.length === 0) {
      throw new BadRequestException(
        `Permission "${permission.name}" declares no actions, omit "actions" to grant it as a whole`,
      );
    }

    const declared = new Set(permission.actions);
    const unknown = actions.filter((action) => !declared.has(action));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Actions [${unknown.join(', ')}] are not declared by permission "${permission.name}"`,
      );
    }

    return actions;
  }

  private async save(
    grant: Grant,
    role: Role,
    permission: Permission,
  ): Promise<Grant> {
    try {
      return await this.grantRepository.save(grant);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `Role "${role.name}" already has a grant for permission "${permission.name}"`,
        );
      }

      throw error;
    }
  }

  private toView(grant: Grant): GrantView {
    return {
      id: grant.id,
      roleId: grant.roleId,
      roleName: grant.role.name,
      permissionId: grant.permissionId,
      permissionName: grant.permission.name,
      actions: grant.actions,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
    };
  }
}
