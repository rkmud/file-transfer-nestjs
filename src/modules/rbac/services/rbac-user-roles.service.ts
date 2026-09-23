import {
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '@/modules/users/users.service';
import { AssignRoleDto } from '../dto/assign-role.dto';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { RbacAuditService } from '../rbac.audit.service';
import { RbacService } from '../rbac.service';
import { UserRoleView } from '../rbac.types';
import { isUniqueViolation } from '../rbac.utils';

const assignmentId = (userId: string, roleId: string): string =>
  `${userId}:${roleId}`;

@Injectable()
export class RbacUserRolesService {
  constructor(
    @InjectRepository(UserRole)
    private userRoleRepository: Repository<UserRole>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    private usersService: UsersService,
    private rbacService: RbacService,
    private audit: RbacAuditService,
  ) {}

  async findAll(userId: string): Promise<UserRoleView[]> {
    await this.requireUser(userId);

    const userRoles = await this.userRoleRepository.find({
      where: { userId },
      relations: { role: true },
      order: { role: { name: 'ASC' } },
    });

    return userRoles.map((userRole) => this.toView(userRole));
  }

  assign(
    actorUserId: string,
    userId: string,
    dto: AssignRoleDto,
  ): Promise<UserRoleView> {
    return this.audit.track(
      {
        actorUserId,
        operation: 'create',
        entity: 'userRole',
        entityId: assignmentId(userId, dto.roleId),
      },
      HttpStatus.CREATED,
      async () => {
        const role = await this.requireUserAndRole(userId, dto.roleId);

        await this.ensureNotAssigned(userId, role);

        const userRole = await this.save(
          this.userRoleRepository.create({ userId, roleId: role.id }),
          role,
        );

        await this.rbacService.reload();

        return this.toView({ ...userRole, role });
      },
    );
  }

  revoke(actorUserId: string, userId: string, roleId: string): Promise<void> {
    return this.audit.track(
      {
        actorUserId,
        operation: 'delete',
        entity: 'userRole',
        entityId: assignmentId(userId, roleId),
      },
      HttpStatus.NO_CONTENT,
      async () => {
        const userRole = await this.userRoleRepository.findOne({
          where: { userId, roleId },
        });

        if (!userRole) {
          throw new NotFoundException('Role assignment not found');
        }

        await this.userRoleRepository.delete({ id: userRole.id });
        await this.rbacService.reload();
      },
    );
  }

  private async requireUser(userId: string): Promise<void> {
    const user = await this.usersService.getUserById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  private async requireUserAndRole(
    userId: string,
    roleId: string,
  ): Promise<Role> {
    const [user, role] = await Promise.all([
      this.usersService.getUserById(userId),
      this.roleRepository.findOne({ where: { id: roleId } }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  private async ensureNotAssigned(userId: string, role: Role): Promise<void> {
    const existing = await this.userRoleRepository.findOne({
      where: { userId, roleId: role.id },
    });

    if (existing) {
      throw new ConflictException(`User already has role "${role.name}"`);
    }
  }

  private async save(userRole: UserRole, role: Role): Promise<UserRole> {
    try {
      return await this.userRoleRepository.save(userRole);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`User already has role "${role.name}"`);
      }

      throw error;
    }
  }

  private toView(userRole: UserRole): UserRoleView {
    return {
      id: userRole.id,
      userId: userRole.userId,
      roleId: userRole.roleId,
      roleName: userRole.role.name,
      createdAt: userRole.createdAt,
    };
  }
}
