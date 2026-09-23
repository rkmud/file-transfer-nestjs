import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SignOptions } from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { SALT_ROUNDS } from '@/common/crypto/bcrypt.constants';
import { LoginConfig } from '@/core/config/configuration';
import { MailService } from '@/mail/mail.service';
import { RBAC_USER_ROLE } from '@/modules/rbac/rbac.constants';
import { RbacRolesService } from '@/modules/rbac/services/rbac-roles.service';
import { RbacUserRolesService } from '@/modules/rbac/services/rbac-user-roles.service';
import { OtpPurpose } from '@/modules/users/otp.entity';
import { CreateUserDto } from '@/modules/users/dto/create-user.dto';
import { User } from '@/modules/users/users.entity';
import { UsersService } from '@/modules/users/users.service';
import {
  ACCESS_TOKEN_TYPE,
  INVALID_CREDENTIALS_MESSAGE,
  REFRESH_TOKEN_TYPE,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import {
  RegistrationResult,
  AuthTokens,
  LoginResult,
  PublicUser,
  RefreshResult,
  RequestMeta,
  VerificationRequired,
  VerifyEmailResult,
} from './auth.types';
import { TokenPayload } from '@/common/auth-token/auth-token.types';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  randomBytes(32).toString('hex'),
  SALT_ROUNDS,
);

type JwtExpiresKey = 'jwtAccessExpiresIn' | 'jwtRefreshExpiresIn';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
    private rbacRolesService: RbacRolesService,
    private rbacUserRolesService: RbacUserRolesService,
  ) {}

  async registration(userDto: CreateUserDto): Promise<RegistrationResult> {
    const candidate = await this.usersService.getUserByEmail(userDto.email);

    if (candidate) {
      throw new HttpException('User already exists', HttpStatus.BAD_REQUEST);
    }

    const role = await this.requireDefaultUserRole();
    const user = await this.usersService.create(userDto);

    await this.rbacUserRolesService.assign(user.id, user.id, {
      roleId: role.id,
    });

    const expiresAt = await this.issueAndSendOtp(user);

    return {
      user: this.toPublicUser(user),
      tokens: this.generateTokens(user),
      verificationRequired: true,
      expiresAt: expiresAt.toISOString(),
      message: 'Verification code has been sent to your email',
    };
  }

  async verifyEmail(
    userId: string,
    dto: VerifyEmailDto,
  ): Promise<VerifyEmailResult> {
    const user = await this.requireUnverifiedUser(userId);

    await this.usersService.verifyOtp(
      user.id,
      OtpPurpose.Registration,
      dto.otp,
    );
    await this.usersService.markEmailVerified(user.id);

    user.isEmailVerified = true;

    return {
      user: this.toPublicUser(user),
      message: 'Email verified successfully',
      tokens: this.generateTokens(user),
    };
  }

  async resendOtp(userId: string): Promise<VerificationRequired> {
    const user = await this.requireUnverifiedUser(userId);
    const expiresAt = await this.issueAndSendOtp(user);

    return {
      verificationRequired: true,
      expiresAt: expiresAt.toISOString(),
      message: 'A new verification code has been sent',
    };
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    const { maxFailedAttempts, lockoutSeconds } = this.getLoginConfig();
    const user = await this.usersService.getUserByEmailWithPassword(dto.email);

    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);

      this.logFailedAttempt(dto.email, meta, 'unknown email');

      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    this.assertNotLocked(user, meta);

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      const lockedUntil = await this.usersService.registerFailedLogin(
        user.id,
        maxFailedAttempts,
        lockoutSeconds,
      );

      this.logFailedAttempt(dto.email, meta, 'invalid password');

      if (lockedUntil) {
        user.lockedUntil = lockedUntil;
        this.assertNotLocked(user, meta);
      }

      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    await this.usersService.registerSuccessfulLogin(user.id);

    return {
      user: this.toPublicUser(user),
      tokens: this.generateTokens(user),
    };
  }

  async refreshTokens(
    refreshToken: string,
    meta: RequestMeta,
  ): Promise<RefreshResult> {
    let payload: TokenPayload;

    try {
      payload = this.jwtService.verify<TokenPayload>(refreshToken);
    } catch (error) {
      this.logger.warn(
        `Refresh token validation failed: reason=${this.describe(error)} ip=${meta.ip}`,
      );

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== REFRESH_TOKEN_TYPE) {
      this.logger.warn(
        `Refresh token validation failed: reason=wrong-token-type ip=${meta.ip}`,
      );

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.getUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    this.assertNotLocked(user, meta);

    return { tokens: this.generateTokens(user) };
  }

  generateTokens(user: User): AuthTokens {
    const payload = { sub: user.id, email: user.email };

    return {
      accessToken: this.jwtService.sign(
        { ...payload, type: ACCESS_TOKEN_TYPE },
        { expiresIn: this.getExpiresIn('jwtAccessExpiresIn') },
      ),
      refreshToken: this.jwtService.sign(
        { ...payload, type: REFRESH_TOKEN_TYPE },
        { expiresIn: this.getExpiresIn('jwtRefreshExpiresIn') },
      ),
    };
  }

  private async issueAndSendOtp(user: User): Promise<Date> {
    const otp = await this.usersService.issueOtp(
      user.id,
      OtpPurpose.Registration,
    );

    await this.mailService
      .sendVerificationEmail(user.email, otp.code, otp.expiresAt)
      .catch(() => {
        throw new ServiceUnavailableException('Failed to send email');
      });

    return otp.expiresAt;
  }

  private assertNotLocked({ lockedUntil }: User, meta: RequestMeta): void {
    if (!lockedUntil || lockedUntil <= new Date()) {
      return;
    }

    this.logger.warn(
      `Login blocked: reason=account-locked ip=${meta.ip} userAgent=${meta.userAgent}`,
    );

    throw new ForbiddenException({
      message: 'Account is temporarily locked, try again later',
      retryAfterSeconds: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
    });
  }

  private logFailedAttempt(
    email: string,
    meta: RequestMeta,
    reason: string,
  ): void {
    this.logger.warn(
      `Failed login attempt: email=${email} reason=${reason} ip=${meta.ip} userAgent=${meta.userAgent}`,
    );
  }

  private getLoginConfig(): LoginConfig {
    return this.configService.getOrThrow<LoginConfig>('login');
  }

  private async requireDefaultUserRole() {
    try {
      return await this.rbacRolesService.findByName(RBAC_USER_ROLE);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ServiceUnavailableException(
          `Default role "${RBAC_USER_ROLE}" is not configured`,
        );
      }

      throw error;
    }
  }

  private async requireUnverifiedUser(userId: string): Promise<User> {
    const user = await this.usersService.getUserById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    return user;
  }

  private toPublicUser({
    id,
    email,
    isEmailVerified,
    createdAt,
  }: User): PublicUser {
    return { id, email, isEmailVerified, createdAt };
  }

  private getExpiresIn(key: JwtExpiresKey): SignOptions['expiresIn'] {
    return this.configService.getOrThrow<SignOptions['expiresIn']>(key);
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.name : 'unknown error';
  }
}
