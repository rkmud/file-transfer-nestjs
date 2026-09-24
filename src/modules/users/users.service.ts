import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from './users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { SALT_ROUNDS } from '@/common/crypto/bcrypt.constants';
import { OtpConfig } from '@/core/config/configuration';
import { Otp, OtpPurpose } from './otp.entity';

const OTP_LENGTH = 6;

export interface IssuedOtp {
  id: string;
  code: string;
  expiresAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Otp)
    private otpRepository: Repository<Otp>,
    private configService: ConfigService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = this.userRepository.create({
      email: dto.email,
      password: hashedPassword,
    });

    return this.userRepository.save(user);
  }

  async getUserByEmail(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });

    return user;
  }

  async getUserByEmailWithPassword(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        isEmailVerified: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async getUserById(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  async update(id: string, changes: Partial<User>): Promise<void> {
    if (Object.keys(changes).length > 0) {
      await this.userRepository.update({ id }, changes);
    }
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.userRepository.update(
      { id },
      { password: await bcrypt.hash(password, SALT_ROUNDS) },
    );
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.userRepository.update({ id }, { isEmailVerified: true });
  }

  async registerFailedLogin(
    id: string,
    maxFailedAttempts: number,
    lockoutSeconds: number,
  ): Promise<Date | null> {
    await this.userRepository.increment({ id }, 'failedLoginAttempts', 1);

    const user = await this.userRepository.findOne({ where: { id } });

    if (!user || user.failedLoginAttempts < maxFailedAttempts) {
      return null;
    }

    const lockedUntil = new Date(Date.now() + lockoutSeconds * 1000);

    await this.userRepository.update(
      { id },
      { failedLoginAttempts: 0, lockedUntil },
    );

    return lockedUntil;
  }

  async registerSuccessfulLogin(id: string): Promise<void> {
    await this.userRepository.update(
      { id },
      {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    );
  }

  async clearLockout(id: string): Promise<void> {
    await this.userRepository.update(
      { id },
      { failedLoginAttempts: 0, lockedUntil: null },
    );
  }

  async issueOtp(
    userId: string,
    purpose: OtpPurpose,
    newEmail: string | null = null,
  ): Promise<IssuedOtp> {
    const { ttlSeconds, resendCooldownSeconds } = this.getOtpConfig();
    const pending = await this.findPendingOtp(userId, purpose);
    const now = new Date();

    if (pending) {
      const nextSendAt = new Date(
        pending.lastSentAt.getTime() + resendCooldownSeconds * 1000,
      );

      if (nextSendAt > now) {
        const retryAfterSeconds = Math.ceil(
          (nextSendAt.getTime() - now.getTime()) / 1000,
        );

        throw new HttpException(
          {
            message: 'A verification code has already been sent',
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    if (pending) {
      await this.otpRepository.delete({ id: pending.id });
    }

    const code = this.generateOtpCode();
    const otp = this.otpRepository.create({
      userId,
      purpose,
      newEmail,
      codeHash: await bcrypt.hash(code, SALT_ROUNDS),
      attempts: 0,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      lastSentAt: now,
    });

    const saved = await this.otpRepository.save(otp);

    return { id: saved.id, code, expiresAt: saved.expiresAt };
  }

  async verifyOtp(
    userId: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<void> {
    const otp = await this.findPendingOtp(userId, purpose);

    if (!otp) {
      throw new BadRequestException('No verification code was requested');
    }

    await this.consumeOtp(otp, code);
  }

  async verifyOtpChallenge(
    challengeId: string,
    userId: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<Otp> {
    const otp = await this.otpRepository.findOne({
      where: { id: challengeId, userId, purpose },
    });

    if (!otp) {
      throw new NotFoundException('Challenge not found');
    }

    await this.consumeOtp(otp, code);

    return otp;
  }

  private async consumeOtp(otp: Otp, code: string): Promise<void> {
    const { maxAttempts } = this.getOtpConfig();

    if (otp.expiresAt <= new Date()) {
      throw new BadRequestException('Otp expired');
    }

    if (otp.attempts >= maxAttempts) {
      throw new HttpException(
        'Too many invalid attempts, request a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.otpRepository.increment({ id: otp.id }, 'attempts', 1);

    const isMatching = await bcrypt.compare(code, otp.codeHash);

    if (!isMatching) {
      throw new BadRequestException({
        message: 'Invalid verification code',
        attemptsLeft: Math.max(maxAttempts - (otp.attempts + 1), 0),
      });
    }

    await this.otpRepository.delete({ id: otp.id });
  }

  private findPendingOtp(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<Otp | null> {
    return this.otpRepository.findOne({
      where: { userId, purpose },
    });
  }

  private generateOtpCode(): string {
    return randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
  }

  private getOtpConfig(): OtpConfig {
    return this.configService.getOrThrow<OtpConfig>('otp');
  }
}
