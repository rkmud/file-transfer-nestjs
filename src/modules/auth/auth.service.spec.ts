import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { InMemoryDatabase } from '../../../test/setup/in-memory-database';
import { FakeClock, useFakeClock } from '../../../test/setup/clock';
import { MailService } from '@/mail/mail.service';
import { RbacRolesService } from '@/modules/rbac/services/rbac-roles.service';
import { RbacUserRolesService } from '@/modules/rbac/services/rbac-user-roles.service';
import { Otp, OtpPurpose } from '@/modules/users/otp.entity';
import { User } from '@/modules/users/users.entity';
import { UsersService } from '@/modules/users/users.service';
import { ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE } from './auth.constants';
import { AuthService } from './auth.service';

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock('@/common/crypto/bcrypt.constants', () => ({ SALT_ROUNDS: 4 }));

// The raw CJS module: `import * as` namespaces are getter-only and cannot be spied on.
const bcryptModule = require('bcrypt') as typeof import('bcrypt');

const SECRET = 'auth-service-spec-secret';
const JWT_OPTIONS = { issuer: 'iss', audience: 'aud' };
const PASSWORD = 'Passw0rd!';
const META = { ip: '10.0.0.1', userAgent: 'jest' };
const LOGIN = { maxFailedAttempts: 3, lockoutSeconds: 900 };
const OTP = { ttlSeconds: 600, maxAttempts: 5, resendCooldownSeconds: 60 };

describe('AuthService', () => {
  let db: InMemoryDatabase;
  let clock: FakeClock;
  let jwt: JwtService;
  let usersService: UsersService;
  let mailService: { sendVerificationEmail: jest.Mock };
  let rbacRoles: { findByName: jest.Mock };
  let rbacUserRoles: { assign: jest.Mock };
  let service: AuthService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    clock = useFakeClock();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    db = new InMemoryDatabase();
    jwt = new JwtService({
      secret: SECRET,
      signOptions: JWT_OPTIONS,
      verifyOptions: JWT_OPTIONS,
    });

    const values: Record<string, unknown> = {
      otp: OTP,
      login: LOGIN,
      jwtAccessExpiresIn: '15m',
      jwtRefreshExpiresIn: '30d',
    };
    const config = {
      getOrThrow: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    usersService = new UsersService(
      db.repo(User) as unknown as Repository<User>,
      db.repo(Otp) as unknown as Repository<Otp>,
      config,
    );
    mailService = { sendVerificationEmail: jest.fn(async () => undefined) };
    rbacRoles = {
      findByName: jest.fn(async (name: string) => ({ id: 'role-user', name })),
    };
    rbacUserRoles = { assign: jest.fn(async () => undefined) };
    service = new AuthService(
      usersService,
      jwt,
      config,
      mailService as unknown as MailService,
      rbacRoles as unknown as RbacRolesService,
      rbacUserRoles as unknown as RbacUserRolesService,
    );
  });

  afterEach(() => {
    clock.restore();
    jest.restoreAllMocks();
  });

  const register = (email = 'new@example.com') =>
    service.registration({ email, password: PASSWORD });

  const seedUser = async (fields: Partial<User> = {}) => {
    const hash = await bcryptModule.hash(PASSWORD, 4);

    return db.repo(User).seed({
      email: 'user@example.com',
      password: hash,
      isEmailVerified: true,
      ...fields,
    })[0];
  };

  const lastOtpCode = () =>
    mailService.sendVerificationEmail.mock.calls.at(-1)?.[1] as string;

  describe('registration', () => {
    it('creates an unverified user, assigns the default role, emails an OTP and issues tokens', async () => {
      const result = await register();
      const [stored] = db.repo(User).all();

      expect(stored).toMatchObject({
        email: 'new@example.com',
        isEmailVerified: false,
      });
      expect(rbacRoles.findByName).toHaveBeenCalledWith('user');
      expect(rbacUserRoles.assign).toHaveBeenCalledWith(stored.id, stored.id, {
        roleId: 'role-user',
      });
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'new@example.com',
        expect.stringMatching(/^\d{6}$/),
        new Date(clock.now().getTime() + OTP.ttlSeconds * 1000),
      );
      expect(result).toMatchObject({
        user: {
          id: stored.id,
          email: 'new@example.com',
          isEmailVerified: false,
        },
        verificationRequired: true,
        expiresAt: new Date(
          clock.now().getTime() + OTP.ttlSeconds * 1000,
        ).toISOString(),
      });
      expect(result.user).not.toHaveProperty('password');
      expect(jwt.verify(result.tokens.accessToken)).toMatchObject({
        sub: stored.id,
        type: ACCESS_TOKEN_TYPE,
      });
    });

    it('rejects an existing email with 400 "User already exists"', async () => {
      await register();

      const error = (await register().catch(
        (e: unknown) => e,
      )) as HttpException;

      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(error.message).toBe('User already exists');
      expect(db.repo(User).all()).toHaveLength(1);
    });

    it('fails with 503 when the default role is not configured', async () => {
      rbacRoles.findByName.mockRejectedValueOnce(new NotFoundException());

      await expect(register()).rejects.toThrow(ServiceUnavailableException);
      expect(db.repo(User).all()).toHaveLength(0);
    });

    it('rethrows unexpected role lookup errors', async () => {
      const boom = new Error('db down');

      rbacRoles.findByName.mockRejectedValueOnce(boom);

      await expect(register()).rejects.toBe(boom);
    });

    it('maps a mail delivery failure to 503', async () => {
      mailService.sendVerificationEmail.mockRejectedValueOnce(
        new Error('smtp'),
      );

      await expect(register()).rejects.toThrow(
        new ServiceUnavailableException('Failed to send email'),
      );
    });
  });

  describe('verifyEmail', () => {
    it('verifies with the emailed code, flips the flag and issues fresh tokens', async () => {
      const { user } = await register();

      const result = await service.verifyEmail(user.id, {
        otp: lastOtpCode(),
      });

      expect(db.repo(User).all()[0].isEmailVerified).toBe(true);
      expect(db.repo(Otp).all()).toHaveLength(0);
      expect(result.user.isEmailVerified).toBe(true);
      expect(result.tokens.accessToken).toEqual(expect.any(String));
    });

    it('rejects a wrong code with 400', async () => {
      const { user } = await register();
      const wrong = lastOtpCode() === '000000' ? '111111' : '000000';

      await expect(
        service.verifyEmail(user.id, { otp: wrong }),
      ).rejects.toThrow(BadRequestException);
      expect(db.repo(User).all()[0].isEmailVerified).toBe(false);
    });

    it('rejects an already verified user with 400', async () => {
      const user = await seedUser();

      await expect(
        service.verifyEmail(user.id, { otp: '123456' }),
      ).rejects.toThrow('Email is already verified');
    });

    it('404s for an unknown user', async () => {
      await expect(
        service.verifyEmail('missing', { otp: '123456' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resendOtp', () => {
    it('sends a new code once the cooldown elapsed and replaces the OTP row', async () => {
      const { user } = await register();
      const firstId = db.repo(Otp).all()[0].id;

      clock.advance(OTP.resendCooldownSeconds * 1000);

      const result = await service.resendOtp(user.id);

      expect(result).toEqual({
        verificationRequired: true,
        expiresAt: new Date(
          clock.now().getTime() + OTP.ttlSeconds * 1000,
        ).toISOString(),
        message: 'A new verification code has been sent',
      });
      expect(mailService.sendVerificationEmail).toHaveBeenCalledTimes(2);
      expect(db.repo(Otp).all()).toHaveLength(1);
      expect(db.repo(Otp).all()[0].id).not.toBe(firstId);
    });

    it('rejects inside the cooldown with 429', async () => {
      const { user } = await register();

      const error = (await service
        .resendOtp(user.id)
        .catch((e: unknown) => e)) as HttpException;

      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(db.repo(Otp).all()[0].purpose).toBe(OtpPurpose.Registration);
    });
  });

  describe('login', () => {
    it('returns the public user and tokens and resets the failure counter', async () => {
      const user = await seedUser({ failedLoginAttempts: 2 });

      const result = await service.login(
        { email: user.email, password: PASSWORD },
        META,
      );

      expect(result.user).toEqual({
        id: user.id,
        email: user.email,
        isEmailVerified: true,
        createdAt: user.createdAt,
      });
      expect(db.repo(User).all()[0]).toMatchObject({
        failedLoginAttempts: 0,
        lastLoginAt: clock.now(),
      });
    });

    it('compares an unknown email against the dummy hash and returns the same 401 as a wrong password', async () => {
      const user = await seedUser();
      const compare = jest.spyOn(bcryptModule, 'compare');

      const unknown = await service
        .login({ email: 'ghost@example.com', password: PASSWORD }, META)
        .catch((e: unknown) => e);

      expect(compare).toHaveBeenCalledTimes(1);

      const [plain, dummyHash] = compare.mock.calls[0] as unknown as [
        string,
        string,
      ];

      expect(plain).toBe(PASSWORD);
      expect(dummyHash).toMatch(/^\$2[aby]\$/);
      expect(dummyHash).not.toBe(db.repo(User).all()[0].password);

      const wrong = await service
        .login({ email: user.email, password: 'Wrong-pass1!' }, META)
        .catch((e: unknown) => e);

      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect((unknown as HttpException).getResponse()).toEqual(
        (wrong as HttpException).getResponse(),
      );
    });

    it('logs failed attempts with IP/User-Agent but never the password', async () => {
      await seedUser();

      await service
        .login({ email: 'user@example.com', password: 'Wrong-pass1!' }, META)
        .catch(() => undefined);

      const messages = warn.mock.calls.map((c) => String(c[0]));

      expect(messages.join('\n')).toContain('ip=10.0.0.1');
      expect(messages.join('\n')).toContain('userAgent=jest');
      expect(messages.join('\n')).not.toContain('Wrong-pass1!');
    });

    it('locks the account at the threshold with 403 + retryAfterSeconds, then accepts after the window', async () => {
      const user = await seedUser();
      const wrong = { email: user.email, password: 'Wrong-pass1!' };

      for (let i = 1; i < LOGIN.maxFailedAttempts; i += 1) {
        await expect(service.login(wrong, META)).rejects.toThrow(
          UnauthorizedException,
        );
      }

      const lockError = (await service
        .login(wrong, META)
        .catch((e: unknown) => e)) as ForbiddenException;

      expect(lockError).toBeInstanceOf(ForbiddenException);
      expect(lockError.getResponse()).toMatchObject({
        retryAfterSeconds: LOGIN.lockoutSeconds,
      });

      // Correct password is still rejected while the window is open.
      clock.advance(LOGIN.lockoutSeconds * 1000 - 1000);
      await expect(
        service.login({ email: user.email, password: PASSWORD }, META),
      ).rejects.toThrow(ForbiddenException);

      clock.advance(1000);
      await expect(
        service.login({ email: user.email, password: PASSWORD }, META),
      ).resolves.toMatchObject({ user: { id: user.id } });
      expect(db.repo(User).all()[0].lockedUntil).toBeNull();
    });
  });

  describe('generateTokens', () => {
    it('signs access/refresh tokens with distinct type claims and TTLs', async () => {
      const user = await seedUser();
      const { accessToken, refreshToken } = service.generateTokens(user);
      const access = jwt.verify(accessToken);
      const refresh = jwt.verify(refreshToken);
      const now = Math.floor(clock.now().getTime() / 1000);

      expect(access).toMatchObject({
        sub: user.id,
        email: user.email,
        type: ACCESS_TOKEN_TYPE,
        iss: 'iss',
        aud: 'aud',
      });
      expect(access.exp - now).toBe(15 * 60);
      expect(refresh).toMatchObject({ sub: user.id, type: REFRESH_TOKEN_TYPE });
      expect(refresh.exp - now).toBe(30 * 24 * 60 * 60);
    });
  });

  describe('refreshTokens', () => {
    it('issues a brand-new pair for a valid refresh token', async () => {
      const user = await seedUser();
      const { refreshToken } = service.generateTokens(user);

      clock.advance(1000);

      const { tokens } = await service.refreshTokens(refreshToken, META);

      expect(tokens.refreshToken).not.toBe(refreshToken);
      expect(jwt.verify(tokens.accessToken).type).toBe(ACCESS_TOKEN_TYPE);
      expect(jwt.verify(tokens.refreshToken).type).toBe(REFRESH_TOKEN_TYPE);
    });

    it('rejects an access token', async () => {
      const user = await seedUser();
      const { accessToken } = service.generateTokens(user);

      await expect(service.refreshTokens(accessToken, META)).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
    });

    it('rejects an expired refresh token', async () => {
      const user = await seedUser();
      const { refreshToken } = service.generateTokens(user);

      clock.advance(30 * 24 * 60 * 60 * 1000 + 1000);

      await expect(service.refreshTokens(refreshToken, META)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(String(warn.mock.calls.at(-1)?.[0])).toContain(
        'TokenExpiredError',
      );
      expect(String(warn.mock.calls.at(-1)?.[0])).not.toContain(refreshToken);
    });

    it('rejects a malformed token and a non-Error verify failure', async () => {
      await expect(service.refreshTokens('garbage', META)).rejects.toThrow(
        UnauthorizedException,
      );

      jest.spyOn(jwt, 'verify').mockImplementationOnce(() => {
        throw 'boom';
      });
      await expect(service.refreshTokens('x', META)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(String(warn.mock.calls.at(-1)?.[0])).toContain('unknown error');
    });

    it('rejects a token for a deleted user', async () => {
      const token = jwt.sign({
        sub: 'gone',
        email: 'g@example.com',
        type: REFRESH_TOKEN_TYPE,
      });

      await expect(service.refreshTokens(token, META)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a locked user with 403', async () => {
      const user = await seedUser({
        lockedUntil: new Date(Date.now() + 60_000),
      });
      const { refreshToken } = service.generateTokens(user);

      await expect(service.refreshTokens(refreshToken, META)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
