import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from './users.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { isUUID } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { SALT_ROUNDS } from '@/common/crypto/bcrypt.constants';
import { OtpConfig } from '@/core/config/configuration';
import { Otp, OtpPurpose } from './otp.entity';
import {
  UserListKey,
  UserListQuery,
  UserListResult,
  UserListSort,
} from './users.types';

const OTP_LENGTH = 6;

const LIST_SORT_COLUMNS: Record<
  UserListSort,
  {
    property: keyof User;
    column: string;
    timestamp: boolean;
    nullable: boolean;
  }
> = {
  created_at: {
    property: 'createdAt',
    column: 'created_at',
    timestamp: true,
    nullable: false,
  },
  last_login: {
    property: 'lastLoginAt',
    column: 'last_login_at',
    timestamp: true,
    nullable: true,
  },
  email: {
    property: 'email',
    column: 'email',
    timestamp: false,
    nullable: false,
  },
};

const LIST_SORT_VALUE_ALIAS = 'list_sort_value';

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

  async findPage(query: UserListQuery): Promise<UserListResult<User>> {
    if (query.status === 'deleted') {
      return { items: [], nextKey: null };
    }

    const sort = LIST_SORT_COLUMNS[query.sort];
    const column = `"user"."${sort.column}"`;
    const direction = query.order === 'asc' ? 'ASC' : 'DESC';
    const comparator = query.order === 'asc' ? '>' : '<';
    const sortValue = sort.timestamp
      ? `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      : column;

    const qb = this.userRepository
      .createQueryBuilder('user')
      .addSelect(sortValue, LIST_SORT_VALUE_ALIAS)
      .orderBy(
        `user.${sort.property}`,
        direction,
        sort.nullable ? 'NULLS LAST' : undefined,
      )
      .addOrderBy('user.id', direction)
      .limit(query.limit + 1);

    if (query.status === 'blocked') {
      qb.andWhere('"user"."locked_until" > now()');
    } else if (query.status === 'active') {
      qb.andWhere(
        '("user"."locked_until" IS NULL OR "user"."locked_until" <= now())',
      );
    }

    const search = query.q?.trim();

    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;

      qb.andWhere(
        new Brackets((where) => {
          where
            .where('"user"."email" ILIKE :pattern', { pattern })
            .orWhere('"user"."first_name" ILIKE :pattern', { pattern })
            .orWhere('"user"."last_name" ILIKE :pattern', { pattern });

          if (isUUID(search)) {
            where.orWhere('"user"."id" = :searchId', { searchId: search });
          }
        }),
      );
    }

    if (query.after) {
      this.applyKeyset(qb, column, comparator, sort.nullable, query.after);
    }

    const { entities, raw } =
      await qb.getRawAndEntities<Record<string, string | null>>();
    const hasMore = entities.length > query.limit;
    const items = hasMore ? entities.slice(0, query.limit) : entities;
    const last = items.at(-1);

    if (!hasMore || !last) {
      return { items, nextKey: null };
    }

    const lastRaw = raw.find((row) => row.user_id === last.id);

    return {
      items,
      nextKey: { value: lastRaw?.[LIST_SORT_VALUE_ALIAS] ?? null, id: last.id },
    };
  }

  private applyKeyset(
    qb: ReturnType<Repository<User>['createQueryBuilder']>,
    column: string,
    comparator: '<' | '>',
    nullable: boolean,
    after: UserListKey,
  ): void {
    const params = { afterValue: after.value, afterId: after.id };

    if (after.value === null) {
      qb.andWhere(
        `${column} IS NULL AND "user"."id" ${comparator} :afterId`,
        params,
      );

      return;
    }

    qb.andWhere(
      `(${column} ${comparator} :afterValue OR (${column} = :afterValue AND "user"."id" ${comparator} :afterId)${
        nullable ? ` OR ${column} IS NULL` : ''
      })`,
      params,
    );
  }

  async update(id: string, changes: Partial<User>): Promise<void> {
    if (Object.keys(changes).length > 0) {
      await this.userRepository.update({ id }, changes);
    }
  }
  /** Hard delete; OTP rows and role assignments are removed by FK cascade. */
  async delete(id: string): Promise<boolean> {
    const result = await this.userRepository.delete({ id });

    return (result.affected ?? 0) > 0;
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
