import { ThrottlerStorage } from '@nestjs/throttler';
import { compare } from 'bcrypt';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { UserRole } from '@/modules/rbac/entities/user-role.entity';
import { Otp, OtpPurpose } from '@/modules/users/otp.entity';
import { User } from '@/modules/users/users.entity';
import {
  createTestApp,
  FakeClock,
  TEST_PASSWORD,
  TestApp,
  useFakeClock,
} from '../setup';
import { installUsersQueryResolver } from '../setup/users-query-resolver';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR_MAX_BYTES = 2048;
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('Users (integration)', () => {
  let t: TestApp;
  let clock: FakeClock;

  beforeAll(async () => {
    t = await createTestApp({
      env: { AVATAR_MAX_BYTES: String(AVATAR_MAX_BYTES) },
    });
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    clock = useFakeClock();
    await t.reset();
    t.get<{ storage: Map<string, unknown> }>(ThrottlerStorage).storage.clear();
    installUsersQueryResolver(t.db.repo(User));
  });

  afterEach(() => clock.restore());

  const userRow = (id: string) =>
    t.db
      .repo(User)
      .all()
      .find((u) => u.id === id);

  describe('GET /api/users/:userId', () => {
    it('returns the own profile (200) without security fields', async () => {
      const user = await t.seedUser({ email: 'ada@example.com' });

      const res = await t
        .http()
        .get(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .expect(200);

      expect(res.body).toMatchObject({
        id: user.id,
        email: 'ada@example.com',
        firstName: 'Test',
        lastName: 'User',
        photo: null,
        phone: null,
        bio: null,
        locale: 'en',
        isEmailVerified: true,
        lastLoginAt: null,
      });
      expect(res.body.createdAt).toBe(user.createdAt.toISOString());
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('failedLoginAttempts');
      expect(res.body).not.toHaveProperty('lockedUntil');
    });

    it("returns 403 for another user's profile", async () => {
      const user = await t.seedUser();
      const other = await t.seedUser();

      await t
        .http()
        .get(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(user))
        .expect(403);
    });

    it('lets an admin read any profile including security fields', async () => {
      const admin = await t.seedAdmin();
      const other = await t.seedUser({ failedLoginAttempts: 3 });

      const res = await t
        .http()
        .get(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(admin))
        .expect(200);

      expect(res.body).toMatchObject({
        id: other.id,
        failedLoginAttempts: 3,
        lockedUntil: null,
      });
      expect(res.body).not.toHaveProperty('password');
    });

    it('returns 404 for an unknown user and 400 for a non-uuid id', async () => {
      const admin = await t.seedAdmin();

      await t
        .http()
        .get(`/api/users/${UNKNOWN_ID}`)
        .set('Cookie', t.authCookie(admin))
        .expect(404);
      await t
        .http()
        .get('/api/users/not-a-uuid')
        .set('Cookie', t.authCookie(admin))
        .expect(400);
    });

    it('returns 401 without a cookie, with a bad token or a refresh token', async () => {
      const user = await t.seedUser();

      await t.http().get(`/api/users/${user.id}`).expect(401);
      await t
        .http()
        .get(`/api/users/${user.id}`)
        .set('Cookie', 'access_token=garbage')
        .expect(401);
      await t
        .http()
        .get(`/api/users/${user.id}`)
        .set('Cookie', `access_token=${t.refreshToken(user)}`)
        .expect(401);
    });
  });

  describe('PATCH /api/users/:userId', () => {
    it('updates the owner profile (200) with partial semantics', async () => {
      const user = await t.seedUser({ bio: 'old bio', phone: '+1 555 0000' });

      const res = await t
        .http()
        .patch(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .send({ firstName: 'Grace', locale: 'en-GB', phone: '' })
        .expect(200);

      expect(res.body).toMatchObject({
        firstName: 'Grace',
        lastName: 'User',
        locale: 'en-GB',
        phone: null,
        bio: 'old bio',
      });
      expect(userRow(user.id)).toMatchObject({
        firstName: 'Grace',
        phone: null,
        bio: 'old bio',
      });
    });

    it.each([
      ['invalid locale', { locale: 'English!' }],
      ['invalid phone', { phone: 'call me' }],
      ['non-string name', { firstName: 42 }],
      ['too long bio', { bio: 'x'.repeat(501) }],
    ])('returns 400 on an invalid body (%s)', async (_name, body) => {
      const user = await t.seedUser();

      await t
        .http()
        .patch(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .send(body)
        .expect(400);
    });

    it('returns 400 on an empty update', async () => {
      const user = await t.seedUser();

      await t
        .http()
        .patch(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .send({})
        .expect(400);
    });

    it("returns 403 when updating another user's profile", async () => {
      const user = await t.seedUser();
      const other = await t.seedUser();

      await t
        .http()
        .patch(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(user))
        .send({ firstName: 'Mallory' })
        .expect(403);
      expect(userRow(other.id)?.firstName).toBe('Test');
    });

    it.each([
      ['email', { email: 'me@example.com' }],
      ['isEmailVerified', { isEmailVerified: true }],
      ['failedLoginAttempts', { failedLoginAttempts: 0 }],
      ['lockedUntil', { lockedUntil: null }],
      ['password', { password: 'N3w-Passw0rd!' }],
    ])('returns 403 when self sends %s', async (_field, body) => {
      const user = await t.seedUser();

      await t
        .http()
        .patch(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .send(body)
        .expect(403);
    });

    it('strips an unknown role field and leaves role assignments untouched', async () => {
      const user = await t.seedUser({ roles: ['user'] });

      await t
        .http()
        .patch(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .send({ bio: 'hi', role: 'admin' })
        .expect(200);

      expect(
        t.db
          .repo(UserRole)
          .all()
          .filter((ur) => ur.userId === user.id),
      ).toHaveLength(1);
      await t
        .http()
        .get('/api/users')
        .set('Cookie', t.authCookie(user))
        .expect(403);
    });

    it('lets an admin update admin-only fields and re-hash the password', async () => {
      const admin = await t.seedAdmin();
      const other = await t.seedUser({ failedLoginAttempts: 4 });

      const res = await t
        .http()
        .patch(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(admin))
        .send({
          email: 'Renamed@Example.com',
          isEmailVerified: false,
          failedLoginAttempts: 0,
          lockedUntil: '2026-02-01T00:00:00.000Z',
          password: 'N3w-Passw0rd!',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        email: 'renamed@example.com',
        isEmailVerified: false,
        failedLoginAttempts: 0,
        lockedUntil: '2026-02-01T00:00:00.000Z',
      });

      const row = userRow(other.id)!;

      expect(await compare('N3w-Passw0rd!', row.password)).toBe(true);
      expect(await compare(TEST_PASSWORD, row.password)).toBe(false);
    });

    it('returns 409 when an admin sets an occupied email and 404 for an unknown user', async () => {
      const admin = await t.seedAdmin({ email: 'admin@example.com' });
      const other = await t.seedUser();

      await t
        .http()
        .patch(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(admin))
        .send({ email: 'admin@example.com' })
        .expect(409);
      await t
        .http()
        .patch(`/api/users/${UNKNOWN_ID}`)
        .set('Cookie', t.authCookie(admin))
        .send({ bio: 'x' })
        .expect(404);
    });

    it('returns 401 without a cookie', async () => {
      const user = await t.seedUser();

      await t
        .http()
        .patch(`/api/users/${user.id}`)
        .send({ bio: 'x' })
        .expect(401);
    });

    describe('avatar upload', () => {
      it('stores the avatar under UPLOADS_DIR and replaces the previous one', async () => {
        const user = await t.seedUser();

        const first = await t
          .http()
          .patch(`/api/users/${user.id}`)
          .set('Cookie', t.authCookie(user))
          .field('firstName', 'Pic')
          .attach('photo', PNG, {
            filename: 'me.png',
            contentType: 'image/png',
          })
          .expect(200);

        expect(first.body.firstName).toBe('Pic');
        expect(first.body.photo).toMatch(
          /^\/static\/avatars\/[0-9a-f-]{36}\.png$/,
        );

        const firstFile = join(
          t.dirs.uploads,
          'avatars',
          first.body.photo.split('/').pop(),
        );

        expect(readFileSync(firstFile)).toEqual(PNG);

        const second = await t
          .http()
          .patch(`/api/users/${user.id}`)
          .set('Cookie', t.authCookie(user))
          .attach('photo', JPEG, {
            filename: 'me.jpg',
            contentType: 'image/jpeg',
          })
          .expect(200);

        expect(second.body.photo).toMatch(/\.jpg$/);
        expect(userRow(user.id)?.photo).toBe(second.body.photo);
        expect(existsSync(firstFile)).toBe(false);
      });

      it('returns 415 for an unsupported or spoofed image', async () => {
        const user = await t.seedUser();

        await t
          .http()
          .patch(`/api/users/${user.id}`)
          .set('Cookie', t.authCookie(user))
          .attach('photo', Buffer.from('<svg/>'), {
            filename: 'x.svg',
            contentType: 'image/svg+xml',
          })
          .expect(415);
        await t
          .http()
          .patch(`/api/users/${user.id}`)
          .set('Cookie', t.authCookie(user))
          .attach('photo', PNG, {
            filename: 'x.jpg',
            contentType: 'image/jpeg',
          })
          .expect(415);
        expect(userRow(user.id)?.photo).toBeNull();
      });

      it('returns 413 when the avatar exceeds the size limit', async () => {
        const user = await t.seedUser();
        const big = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]);

        await t
          .http()
          .patch(`/api/users/${user.id}`)
          .set('Cookie', t.authCookie(user))
          .attach('photo', big, {
            filename: 'big.png',
            contentType: 'image/png',
          })
          .expect(413);
      });
    });
  });

  describe('email change', () => {
    const request = (user: User, newEmail: string) =>
      t
        .http()
        .post(`/api/users/${user.id}/email-change`)
        .set('Cookie', t.authCookie(user))
        .send({ newEmail });

    const confirm = (user: User, challengeId: string, code: string) =>
      t
        .http()
        .post(`/api/users/${user.id}/email-change/confirm`)
        .set('Cookie', t.authCookie(user))
        .send({ challengeId, code });

    it('runs the full flow: OTP mailed to the new address, confirmation swaps it', async () => {
      const user = await t.seedUser({
        email: 'old@example.com',
        isEmailVerified: false,
      });

      const started = await request(user, 'New@Example.com').expect(200);

      expect(started.body).toEqual({
        requiresConfirmation: true,
        challengeId: expect.any(String),
        expiresAt: new Date(clock.now().getTime() + 600_000).toISOString(),
      });
      expect(t.mail.sent).toHaveLength(1);
      expect(t.mail.last()).toMatchObject({
        to: 'new@example.com',
        subject: 'Confirm your new email address',
        template: 'email-change-code',
        context: { name: 'Test User', minutesLeft: 10 },
      });
      expect(t.mail.to('old@example.com')).toHaveLength(0);

      const code = t.mail.lastCode('new@example.com');
      const done = await confirm(user, started.body.challengeId, code).expect(
        200,
      );

      expect(done.body).toEqual({
        message: 'Email updated successfully',
        email: 'new@example.com',
      });
      expect(userRow(user.id)).toMatchObject({
        email: 'new@example.com',
        isEmailVerified: true,
      });

      // The challenge is consumed: replaying it is rejected.
      await confirm(user, started.body.challengeId, code).expect(404);
    });

    it('rejects a wrong code (400) and an expired challenge (400)', async () => {
      const user = await t.seedUser();
      const started = await request(user, 'new@example.com').expect(200);
      const code = t.mail.lastCode('new@example.com');
      const wrong = code === '000000' ? '111111' : '000000';

      const res = await confirm(user, started.body.challengeId, wrong).expect(
        400,
      );

      expect(res.body.attemptsLeft).toBe(4);

      clock.advance(601_000);
      await confirm(user, started.body.challengeId, code).expect(400);
      expect(userRow(user.id)?.email).toBe(user.email);
    });

    it('enforces the resend cooldown (429)', async () => {
      const user = await t.seedUser();

      await request(user, 'new@example.com').expect(200);
      await request(user, 'new@example.com').expect(429);

      clock.advance(60_000);
      await request(user, 'newer@example.com').expect(200);
      expect(
        t.db
          .repo(Otp)
          .all()
          .filter((otp) => otp.userId === user.id),
      ).toEqual([
        expect.objectContaining({
          purpose: OtpPurpose.EmailChange,
          newEmail: 'newer@example.com',
        }),
      ]);
    });

    it('returns 409 for an occupied address, 400 for the current or an invalid one', async () => {
      const user = await t.seedUser({ email: 'me@example.com' });

      await t.seedUser({ email: 'taken@example.com' });

      await request(user, 'taken@example.com').expect(409);
      await request(user, 'me@example.com').expect(400);
      await request(user, 'not-an-email').expect(400);
      await confirm(user, 'not-a-uuid', '123456').expect(400);
      await confirm(user, UNKNOWN_ID, '12345').expect(400);
      expect(t.mail.sent).toHaveLength(0);
    });

    it('returns 409 on confirmation when the address was taken meanwhile', async () => {
      const user = await t.seedUser();
      const started = await request(user, 'race@example.com').expect(200);

      await t.seedUser({ email: 'race@example.com' });

      await confirm(
        user,
        started.body.challengeId,
        t.mail.lastCode('race@example.com'),
      ).expect(409);
    });

    it('returns 404 for an unknown challenge', async () => {
      const user = await t.seedUser();

      await confirm(user, UNKNOWN_ID, '123456').expect(404);
    });

    it('returns 503 when the mail cannot be sent', async () => {
      const user = await t.seedUser();

      t.mail.failNext = new Error('smtp down');
      await request(user, 'new@example.com').expect(503);
    });

    it('is self only: 403 for another user and for an admin', async () => {
      const user = await t.seedUser();
      const admin = await t.seedAdmin();

      await t
        .http()
        .post(`/api/users/${user.id}/email-change`)
        .set('Cookie', t.authCookie(admin))
        .send({ newEmail: 'new@example.com' })
        .expect(403);
      await t
        .http()
        .post(`/api/users/${user.id}/email-change/confirm`)
        .set('Cookie', t.authCookie(admin))
        .send({ challengeId: UNKNOWN_ID, code: '123456' })
        .expect(403);
    });

    it('returns 401 without a cookie', async () => {
      const user = await t.seedUser();

      await t
        .http()
        .post(`/api/users/${user.id}/email-change`)
        .send({ newEmail: 'new@example.com' })
        .expect(401);
      await t
        .http()
        .post(`/api/users/${user.id}/email-change/confirm`)
        .send({ challengeId: UNKNOWN_ID, code: '123456' })
        .expect(401);
    });
  });

  describe('deletion', () => {
    const startDeletion = (user: User) =>
      t
        .http()
        .delete(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user));

    const confirmDeletion = (user: User, challengeId: string, code: string) =>
      t
        .http()
        .post(`/api/users/${user.id}/deletion-confirm`)
        .set('Cookie', t.authCookie(user))
        .send({ challengeId, code });

    it('self: DELETE issues a challenge, confirmation deletes and clears cookies', async () => {
      const user = await t.seedUser({
        email: 'bye@example.com',
        roles: ['user'],
      });

      const started = await startDeletion(user).expect(200);

      expect(started.body).toEqual({
        requiresConfirmation: true,
        challengeId: expect.any(String),
        expiresAt: new Date(clock.now().getTime() + 600_000).toISOString(),
        message: 'Deletion OTP code sent to your email address',
      });
      expect(userRow(user.id)).toBeDefined();
      expect(t.mail.last()).toMatchObject({
        to: 'bye@example.com',
        subject: 'Confirm account deletion',
        template: 'account-deletion-code',
      });

      const res = await confirmDeletion(
        user,
        started.body.challengeId,
        t.mail.lastCode('bye@example.com'),
      ).expect(200);

      expect(res.body).toEqual({
        message: 'User account deleted',
        userId: user.id,
      });

      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);

      expect(cookies).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^access_token=;.*Expires=Thu, 01 Jan 1970/),
          expect.stringMatching(/^refresh_token=;.*Expires=Thu, 01 Jan 1970/),
        ]),
      );

      // Cleanup of 007 §4: row, OTPs and role assignments are gone, tokens are dead.
      expect(userRow(user.id)).toBeUndefined();
      expect(
        t.db
          .repo(Otp)
          .all()
          .filter((otp) => otp.userId === user.id),
      ).toHaveLength(0);
      expect(
        t.db
          .repo(UserRole)
          .all()
          .filter((ur) => ur.userId === user.id),
      ).toHaveLength(0);
      await t
        .http()
        .get(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .expect(401);
    });

    it('self deletion removes the avatar file', async () => {
      const user = await t.seedUser({ email: 'pic@example.com' });
      const uploaded = await t
        .http()
        .patch(`/api/users/${user.id}`)
        .set('Cookie', t.authCookie(user))
        .attach('photo', PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(200);
      const file = join(
        t.dirs.uploads,
        'avatars',
        uploaded.body.photo.split('/').pop(),
      );

      expect(existsSync(file)).toBe(true);

      const started = await startDeletion(user).expect(200);

      await confirmDeletion(
        user,
        started.body.challengeId,
        t.mail.lastCode('pic@example.com'),
      ).expect(200);
      expect(existsSync(file)).toBe(false);
    });

    it('rejects a wrong code (400) and an unknown challenge (404), keeping the account', async () => {
      const user = await t.seedUser({ email: 'keep@example.com' });
      const started = await startDeletion(user).expect(200);
      const code = t.mail.lastCode('keep@example.com');

      await confirmDeletion(
        user,
        started.body.challengeId,
        code === '000000' ? '111111' : '000000',
      ).expect(400);
      await confirmDeletion(user, UNKNOWN_ID, code).expect(404);
      await confirmDeletion(user, 'nope', code).expect(400);
      expect(userRow(user.id)).toBeDefined();
    });

    it('rejects an expired challenge (400) and too many attempts (429)', async () => {
      const user = await t.seedUser({ email: 'try@example.com' });
      const started = await startDeletion(user).expect(200);
      const code = t.mail.lastCode('try@example.com');
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i += 1) {
        await confirmDeletion(user, started.body.challengeId, wrong).expect(
          400,
        );
      }

      await confirmDeletion(user, started.body.challengeId, code).expect(429);

      clock.advance(601_000);
      await confirmDeletion(user, started.body.challengeId, code).expect(400);
      expect(userRow(user.id)).toBeDefined();
    });

    it('a repeated DELETE inside the cooldown is 429; a failed mail is 503', async () => {
      const user = await t.seedUser();

      await startDeletion(user).expect(200);
      await startDeletion(user).expect(429);

      clock.advance(60_000);
      t.mail.failNext = new Error('smtp down');
      await startDeletion(user).expect(503);
    });

    it('an admin deletes another user directly, with an optional reason', async () => {
      const admin = await t.seedAdmin();
      const other = await t.seedUser({ roles: ['user'] });

      const res = await t
        .http()
        .delete(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(admin))
        .send({ reason: 'Administrative account removal' })
        .expect(200);

      expect(res.body).toEqual({
        message: 'User account deleted',
        userId: other.id,
      });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(userRow(other.id)).toBeUndefined();
      expect(t.mail.sent).toHaveLength(0);
      expect(
        t.db
          .repo(UserRole)
          .all()
          .filter((ur) => ur.userId === other.id),
      ).toHaveLength(0);
      await t
        .http()
        .get(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(other))
        .expect(401);
    });

    it('an admin deleting themself goes through the OTP flow', async () => {
      const admin = await t.seedAdmin();

      const res = await startDeletion(admin).expect(200);

      expect(res.body.requiresConfirmation).toBe(true);
      expect(userRow(admin.id)).toBeDefined();
    });

    it('negative cases: 403 foreign, 404 unknown, 400 bad id / payload, 403 foreign confirm', async () => {
      const admin = await t.seedAdmin();
      const user = await t.seedUser();
      const other = await t.seedUser();

      await t
        .http()
        .delete(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(user))
        .expect(403);
      await t
        .http()
        .delete(`/api/users/${UNKNOWN_ID}`)
        .set('Cookie', t.authCookie(admin))
        .expect(404);
      await t
        .http()
        .delete('/api/users/not-a-uuid')
        .set('Cookie', t.authCookie(admin))
        .expect(400);
      await t
        .http()
        .delete(`/api/users/${other.id}`)
        .set('Cookie', t.authCookie(admin))
        .send({ reason: 'x'.repeat(501) })
        .expect(400);
      await t
        .http()
        .post(`/api/users/${other.id}/deletion-confirm`)
        .set('Cookie', t.authCookie(admin))
        .send({ challengeId: UNKNOWN_ID, code: '123456' })
        .expect(403);
      expect(userRow(other.id)).toBeDefined();
    });

    it('returns 401 without a cookie', async () => {
      const user = await t.seedUser();

      await t.http().delete(`/api/users/${user.id}`).expect(401);
      await t
        .http()
        .post(`/api/users/${user.id}/deletion-confirm`)
        .send({ challengeId: UNKNOWN_ID, code: '123456' })
        .expect(401);
    });
  });

  describe('GET /api/users', () => {
    const list = (actor: User, query: Record<string, string | number> = {}) =>
      t
        .http()
        .get('/api/users')
        .query(query)
        .set('Cookie', t.authCookie(actor));

    const at = (minutes: number) =>
      new Date(Date.UTC(2026, 0, 1, 0, minutes, 0, 0));

    /** Admin (created last) + five users with distinct creation times. */
    const seedDirectory = async () => {
      const users = [];

      for (let i = 1; i <= 5; i += 1) {
        users.push(
          await t.seedUser({
            email: `member${i}@example.com`,
            firstName: i === 3 ? 'Grace' : 'Test',
            createdAt: at(i),
            lastLoginAt: i % 2 === 0 ? at(100 + i) : null,
            lockedUntil: i === 4 ? at(60 * 24 * 365) : null,
          }),
        );
      }

      const admin = await t.seedAdmin({
        email: 'admin@example.com',
        createdAt: at(10),
      });

      return { users, admin };
    };

    const collectPages = async (
      actor: User,
      query: Record<string, string | number>,
    ) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const params: Record<string, string | number> = cursor
          ? { ...query, cursor }
          : { ...query };
        const res: { body: any } = await list(actor, params).expect(200);

        ids.push(...res.body.items.map((item: any) => item.id));
        cursor = res.body.nextCursor;
        pages += 1;
      } while (cursor);

      return { ids, pages };
    };

    it('returns the documented page envelope to an admin (200)', async () => {
      const { users, admin } = await seedDirectory();

      const res = await list(admin).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['items', 'nextCursor']);
      expect(res.body.nextCursor).toBeNull();
      expect(res.body.items.map((item: any) => item.id)).toEqual([
        admin.id,
        ...users.map((u) => u.id).reverse(),
      ]);
      expect(res.body.items[1]).toEqual({
        id: users[4].id,
        email: 'member5@example.com',
        photo: null,
        firstName: 'Test',
        lastName: 'User',
        phone: null,
        bio: null,
        locale: 'en',
        isEmailVerified: true,
        createdAt: at(5).toISOString(),
        lastLoginAt: null,
        updatedAt: expect.any(String),
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      expect(res.body.items[0]).not.toHaveProperty('password');
    });

    it('pages with a cursor (created_at desc, limit 2) without gaps or duplicates', async () => {
      const { users, admin } = await seedDirectory();

      const { ids, pages } = await collectPages(admin, { limit: 2 });

      expect(pages).toBe(3);
      expect(ids).toEqual([admin.id, ...users.map((u) => u.id).reverse()]);
      expect(t.db.repo(User).queries.at(-1)?.limit).toBe(3);
    });

    it('pages by last_login asc with NULLS LAST', async () => {
      const { users, admin } = await seedDirectory();

      const { ids } = await collectPages(admin, {
        sort: 'last_login',
        order: 'asc',
        limit: 2,
      });

      expect(ids).toEqual([
        users[1].id,
        users[3].id,
        ...[users[0], users[2], users[4], admin]
          .map((u) => u.id)
          .sort((a, b) => (a < b ? -1 : 1)),
      ]);
    });

    it('sorts by email ascending', async () => {
      const { users, admin } = await seedDirectory();

      const res = await list(admin, { sort: 'email', order: 'asc' }).expect(
        200,
      );

      expect(res.body.items.map((item: any) => item.email)).toEqual([
        'admin@example.com',
        ...users.map((u) => u.email),
      ]);
    });

    it('filters by status and searches by name, email and exact id', async () => {
      const { users, admin } = await seedDirectory();

      const blocked = await list(admin, { status: 'blocked' }).expect(200);
      const active = await list(admin, { status: 'active' }).expect(200);
      const deleted = await list(admin, { status: 'deleted' }).expect(200);

      expect(blocked.body.items.map((i: any) => i.id)).toEqual([users[3].id]);
      expect(active.body.items).toHaveLength(5);
      expect(deleted.body).toEqual({ items: [], nextCursor: null });

      const byName = await list(admin, { q: 'gRaCe' }).expect(200);
      const byId = await list(admin, { q: users[0].id }).expect(200);

      expect(byName.body.items.map((i: any) => i.id)).toEqual([users[2].id]);
      expect(byId.body.items.map((i: any) => i.id)).toEqual([users[0].id]);
    });

    it('treats LIKE wildcards in q literally', async () => {
      const admin = await t.seedAdmin({ email: 'admin@example.com' });

      await t.seedUser({ email: 'a_b@example.com' });
      await t.seedUser({ email: 'axb@example.com' });

      const res = await list(admin, { q: 'a_b' }).expect(200);

      expect(res.body.items.map((i: any) => i.email)).toEqual([
        'a_b@example.com',
      ]);
    });

    it.each([
      ['limit above 100', { limit: 101 }],
      ['limit 0', { limit: 0 }],
      ['unknown sort', { sort: 'name' }],
      ['unknown order', { order: 'up' }],
      ['unknown status', { status: 'gone' }],
      ['malformed cursor', { cursor: 'not-a-cursor' }],
    ])('returns 400 for %s', async (_name, query) => {
      const admin = await t.seedAdmin();

      await list(admin, query).expect(400);
    });

    it('returns 400 for a cursor issued for another sort', async () => {
      const { admin } = await seedDirectory();
      const first = await list(admin, { limit: 1 }).expect(200);

      await list(admin, {
        sort: 'email',
        cursor: first.body.nextCursor,
      }).expect(400);
    });

    it('returns 403 for a non-admin and 401 for anonymous callers', async () => {
      const user = await t.seedUser();

      await list(user).expect(403);
      await t.http().get('/api/users').expect(401);
      await t
        .http()
        .get('/api/users')
        .set('Cookie', `access_token=${t.refreshToken(user)}`)
        .expect(401);
    });

    it('allows any holder of users@list', async () => {
      const lister = await t.seedUser({ permissions: ['users@list'] });

      await list(lister).expect(200);
    });

    it('rate-limits the directory listing (USERS_LIST_THROTTLE = 5/min)', async () => {
      const admin = await t.seedAdmin();

      for (let i = 0; i < 5; i += 1) await list(admin).expect(200);

      await list(admin).expect(429);
      // The profile route has its own (global) budget.
      await t
        .http()
        .get(`/api/users/${admin.id}`)
        .set('Cookie', t.authCookie(admin))
        .expect(200);
    });
  });
});
