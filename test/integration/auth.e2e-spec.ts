import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { Otp, OtpPurpose } from '@/modules/users/otp.entity';
import { User } from '@/modules/users/users.entity';
import { UserRole } from '@/modules/rbac/entities/user-role.entity';
import { Role } from '@/modules/rbac/entities/role.entity';
import {
  createTestApp,
  FakeClock,
  TEST_PASSWORD,
  TestApp,
  useFakeClock,
} from '../setup';

jest.mock('@/common/crypto/bcrypt.constants', () => ({ SALT_ROUNDS: 4 }));
jest.setTimeout(30_000);

const MAX_FAILED = 3;
const LOCKOUT_SECONDS = 900;
const OTP_TTL = 600;
const OTP_COOLDOWN = 60;
const OTP_MAX_ATTEMPTS = 3;
const NEW_PASSWORD = 'Str0ng!pass';

interface ParsedCookie {
  name: string;
  value: string;
  attributes: Record<string, string | true>;
}

const parseSetCookies = (res: request.Response): ParsedCookie[] => {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;

  return (header ?? []).map((raw) => {
    const [pair, ...attrs] = raw.split(';').map((part) => part.trim());
    const index = pair.indexOf('=');

    return {
      name: pair.slice(0, index),
      value: pair.slice(index + 1),
      attributes: Object.fromEntries(
        attrs.map((attr) => {
          const [key, ...rest] = attr.split('=');

          return [key.toLowerCase(), rest.length ? rest.join('=') : true];
        }),
      ),
    };
  });
};

const cookieMap = (res: request.Response) =>
  Object.fromEntries(parseSetCookies(res).map((c) => [c.name, c]));

const containsJwt = (body: unknown): boolean =>
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(JSON.stringify(body ?? {}));

describe('Auth (002-registration, 004-authorization)', () => {
  let t: TestApp;
  let clock: FakeClock;

  beforeAll(async () => {
    t = await createTestApp({
      env: {
        LOGIN_MAX_FAILED_ATTEMPTS: String(MAX_FAILED),
        LOGIN_LOCKOUT_SECONDS: String(LOCKOUT_SECONDS),
        OTP_TTL_SECONDS: String(OTP_TTL),
        OTP_RESEND_COOLDOWN_SECONDS: String(OTP_COOLDOWN),
        OTP_MAX_ATTEMPTS: String(OTP_MAX_ATTEMPTS),
      },
    });
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    clock = useFakeClock();
    await t.reset();
  });

  afterEach(() => clock.restore());

  const register = (email = 'new@example.com', password = NEW_PASSWORD) =>
    t.http().post('/api/auth/registration').send({ email, password });

  const accessCookieFrom = (res: request.Response) =>
    `access_token=${cookieMap(res).access_token.value}`;

  const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

  describe('POST /api/auth/registration', () => {
    it('201: creates an unverified user, sets httpOnly cookies, records the OTP mail', async () => {
      const res = await register('  New@Example.com ').expect(201);

      const cookies = cookieMap(res);

      for (const name of ['access_token', 'refresh_token']) {
        expect(cookies[name]).toBeDefined();
        expect(cookies[name].attributes).toMatchObject({
          httponly: true,
          samesite: 'Lax',
          path: '/',
        });
      }

      expect(cookies.access_token.attributes['max-age']).toBe(String(15 * 60));
      expect(cookies.refresh_token.attributes['max-age']).toBe(
        String(30 * 24 * 60 * 60),
      );

      const [user] = t.db.repo(User).all();

      expect(user).toMatchObject({
        email: 'new@example.com',
        isEmailVerified: false,
      });
      expect(user.password).not.toBe(NEW_PASSWORD);
      expect(res.body).toMatchObject({
        user: {
          id: user.id,
          email: 'new@example.com',
          isEmailVerified: false,
        },
        verificationRequired: true,
        expiresAt: new Date(
          clock.now().getTime() + OTP_TTL * 1000,
        ).toISOString(),
      });

      const mail = t.mail.last();

      expect(mail).toMatchObject({
        to: 'new@example.com',
        template: 'verification-code',
      });
      expect(t.mail.lastCode('new@example.com')).toMatch(/^\d{6}$/);

      const otps = t.db.repo(Otp).all();

      expect(otps).toHaveLength(1);
      expect(otps[0]).toMatchObject({
        userId: user.id,
        purpose: OtpPurpose.Registration,
      });
      expect(otps[0].codeHash).not.toBe(t.mail.lastCode('new@example.com'));

      const role = t.db
        .repo(Role)
        .all()
        .find((r) => r.name === 'user');

      expect(t.db.repo(UserRole).all()).toContainEqual(
        expect.objectContaining({ userId: user.id, roleId: role?.id }),
      );

      const payload = t
        .get<JwtService>(JwtService)
        .verify(cookies.access_token.value);

      expect(payload).toMatchObject({ sub: user.id, type: 'access' });
    });

    it('never returns a token in the response body', async () => {
      const res = await register().expect(201);

      expect(res.body).not.toHaveProperty('tokens');
      expect(res.body).not.toHaveProperty('accessToken');
      expect(containsJwt(res.body)).toBe(false);
    });

    it('400 "User already exists" for a registered email (case-insensitive)', async () => {
      await register('dup@example.com').expect(201);

      const res = await register('DUP@example.com').expect(400);

      expect(res.body.message).toBe('User already exists');
      expect(parseSetCookies(res)).toHaveLength(0);
      expect(t.db.repo(User).all()).toHaveLength(1);
    });

    it.each([
      ['invalid email', { email: 'not-an-email', password: NEW_PASSWORD }],
      ['missing email', { password: NEW_PASSWORD }],
      ['short password', { email: 'a@example.com', password: 'A1!a' }],
      [
        'password without a digit',
        { email: 'a@example.com', password: 'NoDigits!!' },
      ],
      [
        'password without a special character',
        { email: 'a@example.com', password: 'NoSpecial11' },
      ],
      ['non-string password', { email: 'a@example.com', password: 12345678 }],
    ])('400 from the ValidationPipe: %s', async (_label, body) => {
      await t.http().post('/api/auth/registration').send(body).expect(400);

      expect(t.db.repo(User).all()).toHaveLength(0);
      expect(t.mail.sent).toHaveLength(0);
    });

    it('503 when the OTP email cannot be delivered', async () => {
      t.mail.failNext = new Error('smtp down');

      await register().expect(503);
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('200 for an unverified user with the emailed code: flag flips, OTP deleted, fresh cookies', async () => {
      const reg = await register().expect(201);
      const code = t.mail.lastCode('new@example.com');

      clock.advance(1000);

      const res = await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', accessCookieFrom(reg))
        .send({ otp: code })
        .expect(200);

      expect(res.body).toMatchObject({
        user: { email: 'new@example.com', isEmailVerified: true },
        message: 'Email verified successfully',
      });
      expect(containsJwt(res.body)).toBe(false);
      expect(t.db.repo(User).all()[0].isEmailVerified).toBe(true);
      expect(t.db.repo(Otp).all()).toHaveLength(0);

      const cookies = cookieMap(res);

      expect(cookies.access_token.value).not.toBe(
        cookieMap(reg).access_token.value,
      );
      expect(cookies.refresh_token).toBeDefined();
    });

    it('400 with attemptsLeft for a wrong code; 429 once attempts are exhausted', async () => {
      const reg = await register().expect(201);
      const code = t.mail.lastCode('new@example.com');
      const cookie = accessCookieFrom(reg);

      const first = await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', cookie)
        .send({ otp: wrongCode(code) })
        .expect(400);

      expect(first.body.attemptsLeft).toBe(OTP_MAX_ATTEMPTS - 1);

      for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
        await t
          .http()
          .post('/api/auth/verify-email')
          .set('Cookie', cookie)
          .send({ otp: wrongCode(code) })
          .expect(400);
      }

      await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', cookie)
        .send({ otp: code })
        .expect(429);
      expect(t.db.repo(User).all()[0].isEmailVerified).toBe(false);
    });

    it('400 for an expired code', async () => {
      const reg = await register().expect(201);
      const code = t.mail.lastCode('new@example.com');

      clock.advance(OTP_TTL * 1000);

      await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', accessCookieFrom(reg))
        .send({ otp: code })
        .expect(400);
    });

    it('400 for a malformed code (ValidationPipe)', async () => {
      const reg = await register().expect(201);

      await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', accessCookieFrom(reg))
        .send({ otp: '12ab' })
        .expect(400);
    });

    it('400 for an already verified user', async () => {
      const user = await t.seedUser({ isEmailVerified: true });

      const res = await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', t.authCookie(user))
        .send({ otp: '123456' })
        .expect(400);

      expect(res.body.message).toBe('Email is already verified');
    });

    it('400 when no code was ever requested', async () => {
      const user = await t.seedUser({ isEmailVerified: false });

      await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', t.authCookie(user))
        .send({ otp: '123456' })
        .expect(400);
    });
  });

  describe('POST /api/auth/resend-otp', () => {
    it('200 after the cooldown: new code mailed and the OTP row replaced', async () => {
      const reg = await register().expect(201);
      const firstOtp = t.db.repo(Otp).all()[0].id;

      clock.advance(OTP_COOLDOWN * 1000);

      const res = await t
        .http()
        .post('/api/auth/resend-otp')
        .set('Cookie', accessCookieFrom(reg))
        .expect(200);

      expect(res.body).toEqual({
        verificationRequired: true,
        expiresAt: new Date(
          clock.now().getTime() + OTP_TTL * 1000,
        ).toISOString(),
        message: 'A new verification code has been sent',
      });
      expect(t.mail.to('new@example.com')).toHaveLength(2);
      expect(t.db.repo(Otp).all()).toHaveLength(1);
      expect(t.db.repo(Otp).all()[0].id).not.toBe(firstOtp);

      await t
        .http()
        .post('/api/auth/verify-email')
        .set('Cookie', accessCookieFrom(reg))
        .send({ otp: t.mail.lastCode('new@example.com') })
        .expect(200);
    });

    it('429 with retryAfterSeconds for a second call inside the cooldown', async () => {
      const reg = await register().expect(201);

      clock.advance(OTP_COOLDOWN * 1000);
      await t
        .http()
        .post('/api/auth/resend-otp')
        .set('Cookie', accessCookieFrom(reg))
        .expect(200);

      clock.advance(10_000);

      const res = await t
        .http()
        .post('/api/auth/resend-otp')
        .set('Cookie', accessCookieFrom(reg))
        .expect(429);

      expect(res.body.retryAfterSeconds).toBe(OTP_COOLDOWN - 10);
      expect(t.mail.to('new@example.com')).toHaveLength(2);
    });

    it('400 for an already verified user', async () => {
      const user = await t.seedUser({ isEmailVerified: true });

      await t
        .http()
        .post('/api/auth/resend-otp')
        .set('Cookie', t.authCookie(user))
        .expect(400);
    });
  });

  describe.each(['/api/auth/verify-email', '/api/auth/resend-otp'])(
    '401 on %s',
    (path) => {
      const body = { otp: '123456' };

      it('without a cookie', async () => {
        await t.http().post(path).send(body).expect(401);
      });

      it('with a Bearer header instead of the cookie', async () => {
        const user = await t.seedUser({ isEmailVerified: false });

        await t
          .http()
          .post(path)
          .set('Authorization', `Bearer ${t.accessToken(user)}`)
          .send(body)
          .expect(401);
      });

      it('with an invalid token', async () => {
        await t
          .http()
          .post(path)
          .set('Cookie', 'access_token=not-a-jwt')
          .send(body)
          .expect(401);
      });

      it('with a refresh token used as the access token', async () => {
        const user = await t.seedUser({ isEmailVerified: false });

        await t
          .http()
          .post(path)
          .set('Cookie', `access_token=${t.refreshToken(user)}`)
          .send(body)
          .expect(401);
      });

      it('with an expired access token', async () => {
        const cookie = accessCookieFrom(await register().expect(201));

        clock.advance(15 * 60 * 1000 + 1000);

        await t.http().post(path).set('Cookie', cookie).send(body).expect(401);
      });

      it('for a user that no longer exists', async () => {
        await t
          .http()
          .post(path)
          .set(
            'Cookie',
            t.authCookie({ id: 'deleted', email: 'gone@example.com' }),
          )
          .send(body)
          .expect(401);
      });
    },
  );

  describe('POST /api/auth/login', () => {
    const login = (email: string, password = TEST_PASSWORD) =>
      t.http().post('/api/auth/login').send({ email, password });

    it('200 + both httpOnly cookies, no token in the body, lastLoginAt stamped', async () => {
      const user = await t.seedUser({ email: 'login@example.com' });

      const res = await login('  LOGIN@example.com ').expect(200);
      const cookies = cookieMap(res);

      expect(cookies.access_token.attributes.httponly).toBe(true);
      expect(cookies.refresh_token.attributes.httponly).toBe(true);
      expect(res.body).toEqual({
        user: {
          id: user.id,
          email: 'login@example.com',
          isEmailVerified: true,
          createdAt: user.createdAt.toISOString(),
        },
      });
      expect(containsJwt(res.body)).toBe(false);
      expect(t.db.repo(User).all()[0].lastLoginAt).toEqual(clock.now());

      await t
        .http()
        .get(`/api/users/${user.id}`)
        .set('Cookie', accessCookieFrom(res))
        .expect(200);
    });

    it('401 with the same generic message for a wrong password and an unknown email', async () => {
      await t.seedUser({ email: 'login@example.com' });

      const wrong = await login('login@example.com', 'Wrong-pass1!').expect(
        401,
      );
      const unknown = await login('ghost@example.com').expect(401);

      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body.message).toBe('Invalid email or password');
      expect(parseSetCookies(wrong)).toHaveLength(0);
    });

    it('400 for an invalid body', async () => {
      await t
        .http()
        .post('/api/auth/login')
        .send({ email: 'nope', password: '' })
        .expect(400);
    });

    it('locks the account after repeated failures (403) and unlocks after the window', async () => {
      await t.seedUser({ email: 'login@example.com' });

      for (let i = 1; i < MAX_FAILED; i += 1) {
        await login('login@example.com', 'Wrong-pass1!').expect(401);
      }

      const locked = await login('login@example.com', 'Wrong-pass1!').expect(
        403,
      );

      expect(locked.body.retryAfterSeconds).toBe(LOCKOUT_SECONDS);

      clock.advance(LOCKOUT_SECONDS * 1000 - 1000);
      await login('login@example.com').expect(403);

      clock.advance(1000);
      await login('login@example.com').expect(200);
    });

    it('a successful login resets the failure counter', async () => {
      await t.seedUser({ email: 'login@example.com' });

      for (let i = 1; i < MAX_FAILED; i += 1) {
        await login('login@example.com', 'Wrong-pass1!').expect(401);
      }

      await login('login@example.com').expect(200);
      expect(t.db.repo(User).all()[0].failedLoginAttempts).toBe(0);

      await login('login@example.com', 'Wrong-pass1!').expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('200 with the refresh cookie: brand-new access/refresh cookies', async () => {
      const user = await t.seedUser();
      const refreshCookie = t.refreshCookie(user);

      clock.advance(1000);

      const res = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(200);

      const cookies = cookieMap(res);

      expect(res.body).toEqual({ message: 'Tokens refreshed' });
      expect(`refresh_token=${cookies.refresh_token.value}`).not.toBe(
        refreshCookie,
      );
      expect(cookies.access_token.attributes.httponly).toBe(true);

      const jwt = t.get<JwtService>(JwtService);

      expect(jwt.verify(cookies.access_token.value).type).toBe('access');
      expect(jwt.verify(cookies.refresh_token.value).type).toBe('refresh');
    });

    it.each([
      ['no cookie', () => undefined],
      ['the access cookie only', (u: User) => t.authCookie(u)],
      [
        'an access token in the refresh cookie',
        (u: User) => `refresh_token=${t.accessToken(u)}`,
      ],
      ['a malformed refresh token', () => 'refresh_token=garbage'],
    ])('401 with %s and both cookies cleared', async (_label, cookieFor) => {
      const user = await t.seedUser();
      const cookie = cookieFor(user);
      let req = t.http().post('/api/auth/refresh');

      if (cookie) req = req.set('Cookie', cookie);

      const res = await req.expect(401);
      const cookies = cookieMap(res);

      for (const name of ['access_token', 'refresh_token']) {
        expect(cookies[name].value).toBe('');
        expect(cookies[name].attributes.expires).toBe(
          'Thu, 01 Jan 1970 00:00:00 GMT',
        );
      }
    });

    it('401 for an expired refresh token', async () => {
      const user = await t.seedUser();
      const login = await t
        .http()
        .post('/api/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
      const cookie = `refresh_token=${cookieMap(login).refresh_token.value}`;

      clock.advance(30 * 24 * 60 * 60 * 1000 + 1000);

      await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(401);
    });

    it('403 while the account is locked', async () => {
      const user = await t.seedUser({
        lockedUntil: new Date(clock.now().getTime() + 60_000),
      });

      await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', t.refreshCookie(user))
        .expect(403);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears both cookies; the protected endpoint then returns 401', async () => {
      const user = await t.seedUser({ email: 'agent@example.com' });
      const agent = request.agent(t.app.getHttpServer());

      await agent
        .post('/api/auth/login')
        .send({ email: 'agent@example.com', password: TEST_PASSWORD })
        .expect(200);
      await agent.get(`/api/users/${user.id}`).expect(200);

      const res = await agent.post('/api/auth/logout').expect(200);
      const cookies = cookieMap(res);

      expect(res.body).toEqual({ message: 'Logged out successfully' });

      for (const name of ['access_token', 'refresh_token']) {
        expect(cookies[name].value).toBe('');
        expect(cookies[name].attributes).toMatchObject({
          expires: 'Thu, 01 Jan 1970 00:00:00 GMT',
          httponly: true,
          path: '/',
          samesite: 'Lax',
        });
      }

      await agent.get(`/api/users/${user.id}`).expect(401);
      await agent.post('/api/auth/refresh').expect(401);
    });

    it('works without being logged in', async () => {
      await t.http().post('/api/auth/logout').expect(200);
    });
  });
});
