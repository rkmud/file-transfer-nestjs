import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RbacService } from '@/modules/rbac/rbac.service';
import { User } from '@/modules/users/users.entity';
import { UsersService } from '@/modules/users/users.service';
import { USERS_ACTIONS, USERS_PERMISSION } from './user-profile.constants';
import { AdminUserProfile, UserProfile } from './user-profile.types';

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private usersService: UsersService,
    private rbacService: RbacService,
  ) {}

  async getProfile(
    actorUserId: string,
    userId: string,
  ): Promise<UserProfile | AdminUserProfile> {
    const isAdmin = await this.canReadAnyUser(actorUserId);

    if (!isAdmin && actorUserId !== userId) {
      this.logger.warn(
        `Access denied: actorUserId=${actorUserId} targetUserId=${userId} status=403`,
      );

      throw new ForbiddenException('Forbidden resource');
    }

    const user = await this.usersService.getUserById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return isAdmin ? this.toAdminProfile(user) : this.toProfile(user);
  }

  private async canReadAnyUser(userId: string): Promise<boolean> {
    const roles = await this.rbacService.getUserRoles(userId);

    return this.rbacService.can({
      userId,
      roles,
      permission: USERS_PERMISSION,
      action: USERS_ACTIONS.read,
    });
  }

  private toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      photo: user.photo,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      bio: user.bio,
      locale: user.locale,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      updatedAt: user.updatedAt,
    };
  }

  private toAdminProfile(user: User): AdminUserProfile {
    return {
      ...this.toProfile(user),
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    };
  }
}
