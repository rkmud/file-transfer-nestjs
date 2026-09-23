import {
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateRoleDto } from '../dto/create-role.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { Grant } from '../entities/grant.entity';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RbacAuditService } from '../rbac.audit.service';
import { RbacService } from '../rbac.service';
import { isUniqueViolation } from '../rbac.utils';

@Injectable()
export class RbacRolesService {
  constructor(
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(Grant)
    private grantRepository: Repository<Grant>,
    @InjectRepository(UserRole)
    private userRoleRepository: Repository<UserRole>,
    private rbacService: RbacService,
    private audit: RbacAuditService,
  ) {}

  findAll(): Promise<Role[]> {
    return this.roleRepository.find({ order: { name: 'ASC' } });
  }

  async findByName(name: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { name } });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  create(actorUserId: string, dto: CreateRoleDto): Promise<Role> {
    return this.audit.track(
      { actorUserId, operation: 'create', entity: 'role' },
      HttpStatus.CREATED,
      async () => {
        await this.ensureNameIsFree(dto.name);

        const role = await this.save(
          this.roleRepository.create({
            name: dto.name,
            description: dto.description ?? null,
          }),
        );

        await this.rbacService.reload();

        return role;
      },
    );
  }

  update(actorUserId: string, id: string, dto: UpdateRoleDto): Promise<Role> {
    return this.audit.track(
      { actorUserId, operation: 'update', entity: 'role', entityId: id },
      HttpStatus.OK,
      async () => {
        const role = await this.requireRole(id);

        if (dto.name !== undefined && dto.name !== role.name) {
          await this.ensureNameIsFree(dto.name);
          role.name = dto.name;
        }

        if (dto.description !== undefined) {
          role.description = dto.description;
        }

        const updated = await this.save(role);

        await this.rbacService.reload();

        return updated;
      },
    );
  }

  remove(actorUserId: string, id: string): Promise<void> {
    return this.audit.track(
      { actorUserId, operation: 'delete', entity: 'role', entityId: id },
      HttpStatus.NO_CONTENT,
      async () => {
        const role = await this.requireRole(id);

        await this.ensureRoleIsUnused(role);
        await this.roleRepository.delete({ id: role.id });
        await this.rbacService.reload();
      },
    );
  }

  private async requireRole(id: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id } });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  private async ensureNameIsFree(name: string): Promise<void> {
    const existing = await this.roleRepository.findOne({ where: { name } });

    if (existing) {
      throw new ConflictException(`Role "${name}" already exists`);
    }
  }

  private async ensureRoleIsUnused(role: Role): Promise<void> {
    const [grants, assignments] = await Promise.all([
      this.grantRepository.countBy({ roleId: role.id }),
      this.userRoleRepository.countBy({ roleId: role.id }),
    ]);

    if (grants > 0 || assignments > 0) {
      throw new ConflictException(
        `Role "${role.name}" cannot be deleted: ${grants} grant(s) and ${assignments} user assignment(s) reference it`,
      );
    }
  }

  private async save(role: Role): Promise<Role> {
    try {
      return await this.roleRepository.save(role);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Role "${role.name}" already exists`);
      }

      throw error;
    }
  }
}
