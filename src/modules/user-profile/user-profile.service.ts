import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailService } from '@/mail/mail.service';
import { RbacService } from '@/modules/rbac/rbac.service';
import { isUniqueViolation } from '@/modules/rbac/rbac.utils';
import { OtpPurpose } from '@/modules/users/otp.entity';
import { User } from '@/modules/users/users.entity';
import { UsersService } from '@/modules/users/users.service';
import { AvatarStorageService } from './avatar-storage.service';
import {
  ConfirmEmailChangeDto,
  RequestEmailChangeDto,
} from './dto/email-change.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ADMIN_ONLY_FIELDS,
  SELF_EDITABLE_FIELDS,
  USERS_ACTIONS,
  USERS_PERMISSION,
} from './user-profile.constants';
import {
  AdminUserProfile,
  EmailChangeChallenge,
  EmailChangeConfirmed,
  UserProfile,
} from './user-profile.types';

type UsersAction = (typeof USERS_ACTIONS)[keyof typeof USERS_ACTIONS];

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private usersService: UsersService,
    private rbacService: RbacService,
    private avatarStorage: AvatarStorageService,
    private mailService: MailService,
  ) {}

  async getProfile(
    actorUserId: string,
    userId: string,
  ): Promise<UserProfile | AdminUserProfile> {
    const isAdmin = await this.can(actorUserId, USERS_ACTIONS.read);

    if (!isAdmin && actorUserId !== userId) {
      this.denyAccess(actorUserId, userId);
    }

    const user = await this.requireUser(userId);

    return isAdmin ? this.toAdminProfile(user) : this.toProfile(user);
  }

  async updateProfile(
    actorUserId: string,
    userId: string,
    dto: UpdateUserDto,
    photo?: Express.Multer.File,
  ): Promise<UserProfile | AdminUserProfile> {
    const isAdmin = await this.can(actorUserId, USERS_ACTIONS.update);

    if (!isAdmin && actorUserId !== userId) {
      this.denyAccess(actorUserId, userId);
    }

    const adminFields = ADMIN_ONLY_FIELDS.filter(
      (field) => dto[field] !== undefined,
    );

    if (!isAdmin && adminFields.length > 0) {
      this.logger.warn(
        `Restricted fields rejected: actorUserId=${actorUserId} targetUserId=${userId} fields=${adminFields.join(',')} status=403`,
      );

      throw new ForbiddenException(
        `Not allowed to update: ${adminFields.join(', ')}`,
      );
    }

    const user = await this.requireUser(userId);
    const changes = this.collectChanges(dto);

    if (Object.keys(changes).length === 0 && !dto.password && !photo) {
      throw new BadRequestException('No fields to update');
    }

    if (changes.email !== undefined && changes.email !== user.email) {
      await this.ensureEmailIsFree(changes.email);
    }

    const format = photo ? this.avatarStorage.validate(photo) : null;

    if (photo && format) {
      changes.photo = await this.avatarStorage.save(photo, format);
    }

    try {
      await this.usersService.update(userId, changes);
    } catch (error) {
      await this.avatarStorage.remove(changes.photo ?? null);

      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already in use');
      }

      throw error;
    }

    if (changes.photo) {
      await this.avatarStorage.remove(user.photo);
    }

    if (dto.password !== undefined) {
      await this.usersService.setPassword(userId, dto.password);
    }

    this.logger.log(
      `Profile updated: actorUserId=${actorUserId} targetUserId=${userId} fields=${[
        ...Object.keys(changes),
        ...(dto.password !== undefined ? ['password'] : []),
      ].join(',')}`,
    );

    return this.getProfile(actorUserId, userId);
  }

  async requestEmailChange(
    actorUserId: string,
    userId: string,
    dto: RequestEmailChangeDto,
  ): Promise<EmailChangeChallenge> {
    this.assertSelf(actorUserId, userId);

    const user = await this.requireUser(userId);

    if (dto.newEmail === user.email) {
      throw new BadRequestException(
        'New email must differ from the current one',
      );
    }

    await this.ensureEmailIsFree(dto.newEmail);

    const otp = await this.usersService.issueOtp(
      user.id,
      OtpPurpose.EmailChange,
      dto.newEmail,
    );

    await this.mailService
      .sendEmailChangeEmail(
        dto.newEmail,
        this.displayName(user),
        otp.code,
        otp.expiresAt,
      )
      .catch(() => {
        throw new ServiceUnavailableException('Failed to send email');
      });

    return {
      requiresConfirmation: true,
      challengeId: otp.id,
      expiresAt: otp.expiresAt.toISOString(),
    };
  }

  async confirmEmailChange(
    actorUserId: string,
    userId: string,
    dto: ConfirmEmailChangeDto,
  ): Promise<EmailChangeConfirmed> {
    this.assertSelf(actorUserId, userId);

    const user = await this.requireUser(userId);
    const challenge = await this.usersService.verifyOtpChallenge(
      dto.challengeId,
      user.id,
      OtpPurpose.EmailChange,
      dto.code,
    );
    const newEmail = challenge.newEmail;

    if (!newEmail) {
      throw new NotFoundException('Challenge not found');
    }

    await this.ensureEmailIsFree(newEmail);

    try {
      await this.usersService.update(user.id, {
        email: newEmail,
        isEmailVerified: true,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already in use');
      }

      throw error;
    }

    this.logger.log(
      `Email changed: userId=${user.id} challengeId=${challenge.id}`,
    );

    return { message: 'Email updated successfully', email: newEmail };
  }

  private collectChanges(dto: UpdateUserDto): Partial<User> {
    const changes: Partial<User> = {};

    for (const field of SELF_EDITABLE_FIELDS) {
      if (dto[field] !== undefined) {
        Object.assign(changes, { [field]: dto[field] });
      }
    }

    if (dto.email !== undefined) changes.email = dto.email;
    if (dto.isEmailVerified !== undefined) {
      changes.isEmailVerified = dto.isEmailVerified;
    }
    if (dto.failedLoginAttempts !== undefined) {
      changes.failedLoginAttempts = dto.failedLoginAttempts;
    }
    if (dto.lockedUntil !== undefined) {
      changes.lockedUntil = dto.lockedUntil ? new Date(dto.lockedUntil) : null;
    }

    return changes;
  }

  private async ensureEmailIsFree(email: string): Promise<void> {
    const existing = await this.usersService.getUserByEmail(email);

    if (existing) {
      throw new ConflictException('Email is already in use');
    }
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.usersService.getUserById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private assertSelf(actorUserId: string, userId: string): void {
    if (actorUserId !== userId) {
      this.denyAccess(actorUserId, userId);
    }
  }

  private denyAccess(actorUserId: string, userId: string): never {
    this.logger.warn(
      `Access denied: actorUserId=${actorUserId} targetUserId=${userId} status=403`,
    );

    throw new ForbiddenException('Forbidden resource');
  }

  private async can(userId: string, action: UsersAction): Promise<boolean> {
    const roles = await this.rbacService.getUserRoles(userId);

    return this.rbacService.can({
      userId,
      roles,
      permission: USERS_PERMISSION,
      action,
    });
  }

  private displayName(user: User): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');

    return name || user.email;
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
