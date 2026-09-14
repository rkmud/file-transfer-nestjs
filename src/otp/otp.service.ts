import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { OtpConfig } from '@/config/configuration';
import { Otp, OtpPurpose } from './otp.entity';

const OTP_LENGTH = 6;
const SALT_ROUNDS = 10;

export interface IssuedOtp {
  id: string;
  code: string;
  expiresAt: Date;
}

@Injectable()
export class OtpService {
  constructor(
    @InjectRepository(Otp)
    private otpRepository: Repository<Otp>,
    private configService: ConfigService,
  ) {}

  async issue(userId: string, purpose: OtpPurpose): Promise<IssuedOtp> {
    const { ttlSeconds, resendCooldownSeconds } = this.getOtpConfig();
    const pending = await this.findPending(userId, purpose);
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

    const code = this.generateCode();
    const otp = pending ?? this.otpRepository.create({ userId, purpose });

    otp.codeHash = await bcrypt.hash(code, SALT_ROUNDS);
    otp.attempts = 0;
    otp.expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    otp.consumedAt = null;
    otp.lastSentAt = now;

    const saved = await this.otpRepository.save(otp);

    return { id: saved.id, code, expiresAt: saved.expiresAt };
  }

  async verify(
    userId: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<void> {
    const { maxAttempts } = this.getOtpConfig();
    const otp = await this.findPending(userId, purpose);

    if (!otp) {
      throw new BadRequestException('No verification code was requested');
    }

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

    await this.otpRepository.update({ id: otp.id }, { consumedAt: new Date() });
  }

  private findPending(
    userId: string,
    purpose: OtpPurpose,
  ): Promise<Otp | null> {
    return this.otpRepository.findOne({
      where: { userId, purpose, consumedAt: IsNull() },
    });
  }

  private generateCode(): string {
    return randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');
  }

  private getOtpConfig(): OtpConfig {
    return this.configService.getOrThrow<OtpConfig>('otp');
  }
}
