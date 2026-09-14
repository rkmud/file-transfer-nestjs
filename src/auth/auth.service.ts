import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SignOptions } from 'jsonwebtoken';
import { MailService } from '@/mail/mail.service';
import { OtpPurpose } from '@/otp/otp.entity';
import { OtpService } from '@/otp/otp.service';
import { CreateUserDto } from '@/users/dto/create-user.dto';
import { User } from '@/users/users.entity';
import { UsersService } from '@/users/users.service';
import { ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE } from './auth.constants';
import { VerifyEmailDto } from './dto/verify-email.dto';
import {
  RegistrationResult,
  AuthTokens,
  PublicUser,
  VerificationRequired,
} from './auth.types';

type JwtExpiresKey = 'jwtAccessExpiresIn' | 'jwtRefreshExpiresIn';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
    private otpService: OtpService,
  ) {}

  async registration(userDto: CreateUserDto): Promise<RegistrationResult> {
    const candidate = await this.usersService.getUserByEmail(userDto.email);

    if (candidate) {
      throw new HttpException('User already exists', HttpStatus.BAD_REQUEST);
    }

    const user = await this.usersService.create(userDto);
    const expiresAt = await this.issueAndSendOtp(user);

    return {
      user: this.toPublicUser(user),
      ...this.generateTokens(user),
      verificationRequired: true,
      expiresAt: expiresAt.toISOString(),
      message: 'Verification code has been sent to your email',
    };
  }

  async verifyEmail(
    userId: string,
    dto: VerifyEmailDto,
  ): Promise<AuthTokens & { user: PublicUser; message: string }> {
    const user = await this.requireUnverifiedUser(userId);

    await this.otpService.verify(user.id, OtpPurpose.Registration, dto.otp);
    await this.usersService.markEmailVerified(user.id);

    user.isEmailVerified = true;

    return {
      user: this.toPublicUser(user),
      message: 'Email verified successfully',
      ...this.generateTokens(user),
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
    const otp = await this.otpService.issue(user.id, OtpPurpose.Registration);

    await this.mailService
      .sendVerificationEmail(user.email, otp.code, otp.expiresAt)
      .catch(() => {
        throw new ServiceUnavailableException('Failed to send email');
      });

    return otp.expiresAt;
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
}
