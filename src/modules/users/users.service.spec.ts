import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { QueryFailedError, Repository } from 'typeorm';
import { InMemoryDatabase } from '../../../test/setup/in-memory-database';
import { QueryContext } from '../../../test/setup/in-memory-repository';
import { FakeClock, useFakeClock } from '../../../test/setup/clock';
import { Otp, OtpPurpose } from './otp.entity';
import { User } from './users.entity';
import { UsersService } from './users.service';
import { UserListQuery } from './users.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Cheaper bcrypt cost: the service behaviour is identical, the suite is faster.
jest.mock('@/common/crypto/bcrypt.constants', () => ({ SALT_ROUNDS: 4 }));

const OTP_CONFIG = {
  ttlSeconds: 600,
  maxAttempts: 3,
  resendCooldownSeconds: 60,
};

describe('UsersService', () => {
  let db: InMemoryDatabase;
  let service: UsersService;
  let clock: FakeClock;

  const users = () => db.repo(User);
  const otps = () => db.repo(Otp);

  beforeEach(() => {
    clock = useFakeClock();
    db = new InMemoryDatabase();

    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'otp') return OTP_CONFIG;
        throw new Error(`unexpected config key ${key}`);
      }),
    } as unknown as ConfigService;

    service = new UsersService(
      users() as unknown as Repository<User>,
      otps() as unknown as Repository<Otp>,
      config,
    );
  });

  afterEach(() => clock.restore());

  const seedUser = (fields: Partial<User> = {}) =>
    users().seed({ email: 'a@example.com', password: 'x', ...fields })[0];

  describe('create', () => {
    it('stores a bcrypt hash of the password, never the plaintext', async () => {
      const created = await service.create({
        email: 'new@example.com',
        password: 'Secret-123',
      });

      const stored = users().all()[0];

      expect(created.id).toBeDefined();
      expect(stored.email).toBe('new@example.com');
      expect(stored.password).not.toBe('Secret-123');
      expect(stored.password).toMatch(/^\$2[aby]\$/);
      await expect(bcrypt.compare('Secret-123', stored.password)).resolves.toBe(
        true,
      );
      expect(stored.isEmailVerified).toBe(false);
    });

    it('rejects a duplicate email (unique constraint, 23505)', async () => {
      await service.create({
        email: 'dup@example.com',
        password: 'Secret-123',
      });

      const error = await service
        .create({ email: 'dup@example.com', password: 'Secret-456' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(QueryFailedError);
      expect((error as any).code).toBe('23505');
      expect(users().all()).toHaveLength(1);
    });
  });

  describe('lookups', () => {
    it('getUserByEmail hides the password column', async () => {
      seedUser();

      const user = await service.getUserByEmail('a@example.com');

      expect(user?.email).toBe('a@example.com');
      expect(user).not.toHaveProperty('password');
      await expect(service.getUserByEmail('none@example.com')).resolves.toBe(
        null,
      );
    });

    it('getUserByEmailWithPassword selects the password and lockout fields', async () => {
      seedUser({ failedLoginAttempts: 2 });

      const user = await service.getUserByEmailWithPassword('a@example.com');

      expect(user?.password).toBe('x');
      expect(user?.failedLoginAttempts).toBe(2);
      expect(user).toHaveProperty('lockedUntil', null);
    });

    it('getUserById returns the user or null', async () => {
      const seeded = seedUser();

      await expect(service.getUserById(seeded.id)).resolves.toMatchObject({
        id: seeded.id,
      });
      await expect(service.getUserById('missing')).resolves.toBeNull();
    });
  });

  describe('update / delete / setPassword / markEmailVerified / clearLockout', () => {
    it('update applies changes and skips an empty patch', async () => {
      const user = seedUser();
      const spy = jest.spyOn(users(), 'update');

      await service.update(user.id, {});
      expect(spy).not.toHaveBeenCalled();

      await service.update(user.id, { firstName: 'Ann' });
      expect(users().all()[0].firstName).toBe('Ann');
    });

    it('delete reports whether a row was removed', async () => {
      const user = seedUser();

      await expect(service.delete(user.id)).resolves.toBe(true);
      await expect(service.delete(user.id)).resolves.toBe(false);
    });

    it('delete treats an undefined affected count as nothing removed', async () => {
      jest.spyOn(users(), 'delete').mockResolvedValueOnce({ raw: [] } as any);

      await expect(service.delete('x')).resolves.toBe(false);
    });

    it('setPassword stores a new hash', async () => {
      const user = seedUser();

      await service.setPassword(user.id, 'Other-456!');

      const stored = users().all()[0].password;

      await expect(bcrypt.compare('Other-456!', stored)).resolves.toBe(true);
    });

    it('markEmailVerified flips the flag', async () => {
      const user = seedUser();

      await service.markEmailVerified(user.id);

      expect(users().all()[0].isEmailVerified).toBe(true);
    });

    it('clearLockout resets counter and lock', async () => {
      const user = seedUser({
        failedLoginAttempts: 3,
        lockedUntil: new Date(Date.now() + 1000),
      });

      await service.clearLockout(user.id);

      expect(users().all()[0]).toMatchObject({
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
    });
  });

  describe('login lockout helpers', () => {
    it('registerFailedLogin increments the counter below the threshold', async () => {
      const user = seedUser();

      await expect(service.registerFailedLogin(user.id, 3, 900)).resolves.toBe(
        null,
      );
      await expect(service.registerFailedLogin(user.id, 3, 900)).resolves.toBe(
        null,
      );

      expect(users().all()[0].failedLoginAttempts).toBe(2);
      expect(users().all()[0].lockedUntil).toBeNull();
    });

    it('registerFailedLogin locks the account at the threshold and resets the counter', async () => {
      const user = seedUser({ failedLoginAttempts: 2 });

      const lockedUntil = await service.registerFailedLogin(user.id, 3, 900);

      expect(lockedUntil).toEqual(new Date(clock.now().getTime() + 900_000));
      expect(users().all()[0]).toMatchObject({
        failedLoginAttempts: 0,
        lockedUntil,
      });
    });

    it('registerFailedLogin returns null for an unknown user', async () => {
      await expect(
        service.registerFailedLogin('missing', 1, 900),
      ).resolves.toBe(null);
    });

    it('registerSuccessfulLogin resets counter/lock and stamps lastLoginAt', async () => {
      const user = seedUser({
        failedLoginAttempts: 4,
        lockedUntil: new Date(Date.now() - 1000),
      });

      await service.registerSuccessfulLogin(user.id);

      expect(users().all()[0]).toMatchObject({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: clock.now(),
      });
    });
  });

  describe('issueOtp', () => {
    it('generates a 6-digit code, stores its bcrypt hash and applies the TTL', async () => {
      const user = seedUser();

      const issued = await service.issueOtp(user.id, OtpPurpose.Registration);

      expect(issued.code).toMatch(/^\d{6}$/);
      expect(issued.expiresAt).toEqual(
        new Date(clock.now().getTime() + OTP_CONFIG.ttlSeconds * 1000),
      );

      const [row] = otps().all();

      expect(row).toMatchObject({
        id: issued.id,
        userId: user.id,
        purpose: OtpPurpose.Registration,
        newEmail: null,
        attempts: 0,
        lastSentAt: clock.now(),
      });
      expect(row.codeHash).not.toContain(issued.code);
      await expect(bcrypt.compare(issued.code, row.codeHash)).resolves.toBe(
        true,
      );
    });

    it('zero-pads short codes to 6 digits', async () => {
      const crypto = jest.requireActual<typeof import('crypto')>('crypto');
      const spy = jest.spyOn(
        crypto,
        'randomInt',
      ) as unknown as jest.SpyInstance;

      spy.mockReturnValueOnce(42);

      try {
        const user = seedUser();
        const issued = await service.issueOtp(user.id, OtpPurpose.Registration);

        expect(issued.code).toBe('000042');
      } finally {
        spy.mockRestore();
      }
    });

    it('stores the new email for an email-change challenge', async () => {
      const user = seedUser();

      await service.issueOtp(user.id, OtpPurpose.EmailChange, 'b@example.com');

      expect(otps().all()[0].newEmail).toBe('b@example.com');
    });

    it('rejects a resend inside the cooldown with 429 and retryAfterSeconds', async () => {
      const user = seedUser();

      await service.issueOtp(user.id, OtpPurpose.Registration);
      clock.advance(20_500);

      const error = (await service
        .issueOtp(user.id, OtpPurpose.Registration)
        .catch((e: unknown) => e)) as HttpException;

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(error.getResponse()).toMatchObject({ retryAfterSeconds: 40 });
      expect(otps().all()).toHaveLength(1);
    });

    it('replaces the pending OTP once the cooldown has elapsed', async () => {
      const user = seedUser();
      const first = await service.issueOtp(user.id, OtpPurpose.Registration);

      clock.advance(OTP_CONFIG.resendCooldownSeconds * 1000);

      const second = await service.issueOtp(user.id, OtpPurpose.Registration);

      expect(otps().all()).toHaveLength(1);
      expect(otps().all()[0].id).toBe(second.id);
      expect(second.id).not.toBe(first.id);
    });

    it('keeps OTPs for different purposes independent', async () => {
      const user = seedUser();

      await service.issueOtp(user.id, OtpPurpose.Registration);
      await service.issueOtp(user.id, OtpPurpose.AccountDeletion);

      expect(otps().all()).toHaveLength(2);
    });
  });

  describe('verifyOtp', () => {
    const issue = async () => {
      const user = seedUser();
      const otp = await service.issueOtp(user.id, OtpPurpose.Registration);

      return { user, otp };
    };

    it('accepts a valid code and deletes the OTP row', async () => {
      const { user, otp } = await issue();

      await service.verifyOtp(user.id, OtpPurpose.Registration, otp.code);

      expect(otps().all()).toHaveLength(0);
    });

    it('rejects when no code was requested', async () => {
      const user = seedUser();

      await expect(
        service.verifyOtp(user.id, OtpPurpose.Registration, '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-used code', async () => {
      const { user, otp } = await issue();

      await service.verifyOtp(user.id, OtpPurpose.Registration, otp.code);

      await expect(
        service.verifyOtp(user.id, OtpPurpose.Registration, otp.code),
      ).rejects.toThrow('No verification code was requested');
    });

    it('rejects a wrong code, increments attempts and reports attemptsLeft', async () => {
      const { user, otp } = await issue();
      const wrong = otp.code === '000000' ? '111111' : '000000';

      const error = (await service
        .verifyOtp(user.id, OtpPurpose.Registration, wrong)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({
        message: 'Invalid verification code',
        attemptsLeft: OTP_CONFIG.maxAttempts - 1,
      });
      expect(otps().all()[0].attempts).toBe(1);
    });

    it('rejects past the attempt limit with 429, even for the correct code', async () => {
      const { user, otp } = await issue();
      const wrong = otp.code === '000000' ? '111111' : '000000';

      for (let i = 0; i < OTP_CONFIG.maxAttempts; i += 1) {
        await expect(
          service.verifyOtp(user.id, OtpPurpose.Registration, wrong),
        ).rejects.toThrow(BadRequestException);
      }

      const error = (await service
        .verifyOtp(user.id, OtpPurpose.Registration, otp.code)
        .catch((e: unknown) => e)) as HttpException;

      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(otps().all()[0].attempts).toBe(OTP_CONFIG.maxAttempts);
    });

    it('clamps attemptsLeft at zero', async () => {
      const { user, otp } = await issue();

      // Simulate a stale in-memory attempt count above the configured limit.
      jest.spyOn(otps(), 'findOne').mockResolvedValueOnce({
        ...otps().all()[0],
        attempts: -5,
        expiresAt: otp.expiresAt,
      } as Otp);
      const wrong = otp.code === '000000' ? '111111' : '000000';
      const error = (await service
        .verifyOtp(user.id, OtpPurpose.Registration, wrong)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(error.getResponse()).toMatchObject({
        attemptsLeft: OTP_CONFIG.maxAttempts + 4,
      });

      jest.spyOn(otps(), 'findOne').mockResolvedValueOnce({
        ...otps().all()[0],
        attempts: OTP_CONFIG.maxAttempts - 1,
      } as Otp);
      const last = (await service
        .verifyOtp(user.id, OtpPurpose.Registration, wrong)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(last.getResponse()).toMatchObject({ attemptsLeft: 0 });
    });

    it('rejects an expired code without counting an attempt', async () => {
      const { user, otp } = await issue();

      clock.advance(OTP_CONFIG.ttlSeconds * 1000);

      await expect(
        service.verifyOtp(user.id, OtpPurpose.Registration, otp.code),
      ).rejects.toThrow('Otp expired');
      expect(otps().all()[0].attempts).toBe(0);
    });

    it('accepts a code one second before expiry', async () => {
      const { user, otp } = await issue();

      clock.advance(OTP_CONFIG.ttlSeconds * 1000 - 1000);

      await expect(
        service.verifyOtp(user.id, OtpPurpose.Registration, otp.code),
      ).resolves.toBeUndefined();
    });
  });

  describe('verifyOtpChallenge', () => {
    it('consumes the matching challenge and returns it', async () => {
      const user = seedUser();
      const otp = await service.issueOtp(
        user.id,
        OtpPurpose.EmailChange,
        'b@example.com',
      );

      const result = await service.verifyOtpChallenge(
        otp.id,
        user.id,
        OtpPurpose.EmailChange,
        otp.code,
      );

      expect(result).toMatchObject({ id: otp.id, newEmail: 'b@example.com' });
      expect(otps().all()).toHaveLength(0);
    });

    it('404s for an unknown challenge or one owned by another user', async () => {
      const user = seedUser();
      const otp = await service.issueOtp(user.id, OtpPurpose.EmailChange);

      await expect(
        service.verifyOtpChallenge(
          otp.id,
          'someone-else',
          OtpPurpose.EmailChange,
          otp.code,
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.verifyOtpChallenge(
          'missing',
          user.id,
          OtpPurpose.EmailChange,
          otp.code,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findPage', () => {
    const baseQuery: UserListQuery = {
      sort: 'created_at',
      order: 'desc',
      limit: 2,
    };
    let captured: QueryContext<User>[];
    let result: { entities: Partial<User>[]; raw: Record<string, any>[] };

    beforeEach(() => {
      captured = [];
      result = { entities: [], raw: [] };
      users().setQueryResolver((ctx) => {
        captured.push(ctx);
        expect(ctx.terminal).toBe('getRawAndEntities');

        return result;
      });
    });

    const call = (method: string) =>
      captured[0].calls.filter((c) => c.method === method);

    it('returns an empty page for status=deleted without querying', async () => {
      await expect(
        service.findPage({ ...baseQuery, status: 'deleted' }),
      ).resolves.toEqual({ items: [], nextKey: null });
      expect(captured).toHaveLength(0);
    });

    it('builds a DESC created_at query with a UTC microsecond sort value and limit+1', async () => {
      await service.findPage(baseQuery);

      const ctx = captured[0];

      expect(ctx.alias).toBe('user');
      expect(ctx.limit).toBe(3);
      expect(call('addSelect')[0].args).toEqual([
        `to_char("user"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        'list_sort_value',
      ]);
      expect(call('orderBy')[0].args).toEqual([
        'user.createdAt',
        'DESC',
        undefined,
      ]);
      expect(call('addOrderBy')[0].args).toEqual(['user.id', 'DESC']);
      expect(ctx.wheres).toEqual([]);
    });

    it('orders last_login ASC with NULLS LAST', async () => {
      await service.findPage({
        ...baseQuery,
        sort: 'last_login',
        order: 'asc',
      });

      expect(call('orderBy')[0].args).toEqual([
        'user.lastLoginAt',
        'ASC',
        'NULLS LAST',
      ]);
      expect(call('addSelect')[0].args[0]).toContain('"user"."last_login_at"');
    });

    it('uses the raw column (no to_char) for email sort', async () => {
      await service.findPage({ ...baseQuery, sort: 'email' });

      expect(call('addSelect')[0].args[0]).toBe('"user"."email"');
    });

    it.each([
      ['blocked', '"user"."locked_until" > now()'],
      [
        'active',
        '("user"."locked_until" IS NULL OR "user"."locked_until" <= now())',
      ],
    ] as const)('filters status=%s', async (status, sql) => {
      await service.findPage({ ...baseQuery, status });

      expect(captured[0].wheres).toEqual([sql]);
    });

    it('searches email/first/last name with an escaped ILIKE pattern', async () => {
      await service.findPage({ ...baseQuery, q: '  50%_off\\x ' });

      const ctx = captured[0];
      const inner = ctx.calls
        .filter((c) => c.method.startsWith('user:brackets.'))
        .map((c) => [c.method.replace('user:brackets.', ''), c.args[0]]);

      expect(ctx.wheres).toEqual(['[Brackets]']);
      expect(ctx.params.pattern).toBe('%50\\%\\_off\\\\x%');
      expect(inner).toEqual([
        ['where', '"user"."email" ILIKE :pattern'],
        ['orWhere', '"user"."first_name" ILIKE :pattern'],
        ['orWhere', '"user"."last_name" ILIKE :pattern'],
      ]);
      expect(ctx.params.searchId).toBeUndefined();
    });

    it('also matches the id when the search term is a UUID', async () => {
      const id = '6f1c2e5a-3b4d-4e8f-9a0b-1c2d3e4f5a6b';

      await service.findPage({ ...baseQuery, q: id });

      const ctx = captured[0];

      expect(ctx.params.searchId).toBe(id);
      expect(
        ctx.calls.some(
          (c) =>
            c.method === 'user:brackets.orWhere' &&
            c.args[0] === '"user"."id" = :searchId',
        ),
      ).toBe(true);
    });

    it('ignores a blank search term', async () => {
      await service.findPage({ ...baseQuery, q: '   ' });

      expect(captured[0].wheres).toEqual([]);
    });

    it('applies a DESC keyset for a non-null key on a non-nullable column', async () => {
      await service.findPage({
        ...baseQuery,
        after: { value: '2026-01-01T00:00:00.000000Z', id: 'u1' },
      });

      const col = '"user"."created_at"';

      expect(captured[0].wheres).toEqual([
        `(${col} < :afterValue OR (${col} = :afterValue AND "user"."id" < :afterId))`,
      ]);
      expect(captured[0].params).toMatchObject({
        afterValue: '2026-01-01T00:00:00.000000Z',
        afterId: 'u1',
      });
    });

    it('includes NULL rows after a non-null key on a nullable column (ASC)', async () => {
      await service.findPage({
        ...baseQuery,
        sort: 'last_login',
        order: 'asc',
        after: { value: 'v', id: 'u1' },
      });

      const col = '"user"."last_login_at"';

      expect(captured[0].wheres).toEqual([
        `(${col} > :afterValue OR (${col} = :afterValue AND "user"."id" > :afterId) OR ${col} IS NULL)`,
      ]);
    });

    it('continues within the NULL tail for a null key', async () => {
      await service.findPage({
        ...baseQuery,
        sort: 'last_login',
        after: { value: null, id: 'u9' },
      });

      expect(captured[0].wheres).toEqual([
        '"user"."last_login_at" IS NULL AND "user"."id" < :afterId',
      ]);
      expect(captured[0].params).toMatchObject({ afterId: 'u9' });
    });

    it('returns all rows and no nextKey when there is no extra row', async () => {
      result = {
        entities: [{ id: 'a' }, { id: 'b' }],
        raw: [
          { user_id: 'a', list_sort_value: '1' },
          { user_id: 'b', list_sort_value: '2' },
        ],
      };

      await expect(service.findPage(baseQuery)).resolves.toEqual({
        items: [{ id: 'a' }, { id: 'b' }],
        nextKey: null,
      });
    });

    it('trims the probe row and builds nextKey from the last item raw sort value', async () => {
      result = {
        entities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        raw: [
          { user_id: 'a', list_sort_value: '1' },
          { user_id: 'b', list_sort_value: '2' },
          { user_id: 'c', list_sort_value: '3' },
        ],
      };

      await expect(service.findPage(baseQuery)).resolves.toEqual({
        items: [{ id: 'a' }, { id: 'b' }],
        nextKey: { value: '2', id: 'b' },
      });
    });

    it('uses a null key value when the raw row or sort value is missing', async () => {
      result = {
        entities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        raw: [{ user_id: 'a', list_sort_value: '1' }],
      };

      await expect(service.findPage(baseQuery)).resolves.toMatchObject({
        nextKey: { value: null, id: 'b' },
      });

      result = {
        entities: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        raw: [{ user_id: 'b', list_sort_value: null }],
      };

      await expect(service.findPage(baseQuery)).resolves.toMatchObject({
        nextKey: { value: null, id: 'b' },
      });
    });

    it('returns no nextKey for limit 0 even when rows exist', async () => {
      result = { entities: [{ id: 'a' }], raw: [] };

      await expect(
        service.findPage({ ...baseQuery, limit: 0 }),
      ).resolves.toEqual({ items: [], nextKey: null });
    });
  });
});
