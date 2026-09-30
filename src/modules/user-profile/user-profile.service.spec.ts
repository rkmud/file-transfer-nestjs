import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OtpPurpose } from '@/modules/users/otp.entity';
import { User } from '@/modules/users/users.entity';
import { encodeUserListCursor } from './user-list-cursor';
import { UserProfileService } from './user-profile.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SELF_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const ADMIN_ID = '00000000-0000-4000-8000-000000000003';
const CHALLENGE_ID = '00000000-0000-4000-8000-0000000000aa';
const EXPIRES_AT = new Date('2026-01-15T10:10:00.000Z');

const makeUser = (overrides: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: SELF_ID,
    email: 'self@example.com',
    photo: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: null,
    bio: null,
    locale: 'en',
    isEmailVerified: true,
    failedLoginAttempts: 2,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  });

const uniqueViolation = () =>
  Object.assign(new Error('duplicate'), { code: '23505' });

describe('UserProfileService', () => {
  let users: Record<string, jest.Mock>;
  let rbac: Record<string, jest.Mock>;
  let avatars: Record<string, jest.Mock>;
  let mail: Record<string, jest.Mock>;
  let service: UserProfileService;
  let store: Map<string, User>;
  let admins: Set<string>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    store = new Map([
      [SELF_ID, makeUser()],
      [OTHER_ID, makeUser({ id: OTHER_ID, email: 'other@example.com' })],
      [ADMIN_ID, makeUser({ id: ADMIN_ID, email: 'admin@example.com' })],
    ]);
    admins = new Set([ADMIN_ID]);

    users = {
      getUserById: jest.fn(async (id: string) => store.get(id) ?? null),
      getUserByEmail: jest.fn(
        async (email: string) =>
          [...store.values()].find((u) => u.email === email) ?? null,
      ),
      findPage: jest.fn(async () => ({ items: [], nextKey: null })),
      update: jest.fn(async () => undefined),
      setPassword: jest.fn(async () => undefined),
      issueOtp: jest.fn(async () => ({
        id: CHALLENGE_ID,
        code: '123456',
        expiresAt: EXPIRES_AT,
      })),
      verifyOtpChallenge: jest.fn(async () => ({
        id: CHALLENGE_ID,
        newEmail: 'new@example.com',
      })),
      delete: jest.fn(async () => true),
    };
    rbac = {
      getUserRoles: jest.fn(async (id: string) =>
        admins.has(id) ? ['admin'] : ['user'],
      ),
      can: jest.fn(async ({ roles }: { roles: string[] }) =>
        roles.includes('admin'),
      ),
      invalidate: jest.fn(),
    };
    avatars = {
      validate: jest.fn(() => 'png'),
      save: jest.fn(async () => '/static/avatars/new.png'),
      remove: jest.fn(async () => undefined),
    };
    mail = {
      sendEmailChangeEmail: jest.fn(async () => undefined),
      sendAccountDeletionEmail: jest.fn(async () => undefined),
    };

    service = new UserProfileService(
      users as any,
      rbac as any,
      avatars as any,
      mail as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getProfile', () => {
    it('returns the own profile without security fields', async () => {
      const profile = await service.getProfile(SELF_ID, SELF_ID);

      expect(profile).toMatchObject({ id: SELF_ID, email: 'self@example.com' });
      expect(profile).not.toHaveProperty('failedLoginAttempts');
      expect(profile).not.toHaveProperty('lockedUntil');
      expect(profile).not.toHaveProperty('password');
      expect(rbac.can).toHaveBeenCalledWith({
        userId: SELF_ID,
        roles: ['user'],
        permission: 'users',
        action: 'read',
      });
    });

    it('denies a foreign profile to a non-admin', async () => {
      await expect(service.getProfile(SELF_ID, OTHER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(users.getUserById).not.toHaveBeenCalled();
    });

    it('returns a foreign profile with security fields to an admin', async () => {
      const profile = await service.getProfile(ADMIN_ID, OTHER_ID);

      expect(profile).toMatchObject({
        id: OTHER_ID,
        failedLoginAttempts: 2,
        lockedUntil: null,
      });
    });

    it('returns 404 for an unknown user', async () => {
      await expect(
        service.getProfile(ADMIN_ID, '00000000-0000-4000-8000-0000000000ff'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listUsers', () => {
    const baseQuery = {
      limit: 20,
      sort: 'created_at' as const,
      order: 'desc' as const,
    };

    it('maps the query to findPage and returns admin rows', async () => {
      users.findPage.mockResolvedValueOnce({
        items: [store.get(OTHER_ID)],
        nextKey: null,
      });

      const page = await service.listUsers(ADMIN_ID, { ...baseQuery } as any);

      expect(users.findPage).toHaveBeenCalledWith({
        q: undefined,
        status: undefined,
        sort: 'created_at',
        order: 'desc',
        limit: 20,
        after: undefined,
      });
      expect(page.nextCursor).toBeNull();
      expect(page.items[0]).toMatchObject({
        id: OTHER_ID,
        failedLoginAttempts: 2,
        lockedUntil: null,
      });
    });

    it('decodes the cursor, passes filters and encodes the next key', async () => {
      const key = { value: 'b@example.com', id: OTHER_ID };
      const cursor = encodeUserListCursor('email', 'asc', {
        value: 'a@example.com',
        id: SELF_ID,
      });

      users.findPage.mockResolvedValueOnce({
        items: [store.get(SELF_ID)],
        nextKey: key,
      });

      const page = await service.listUsers(ADMIN_ID, {
        limit: 5,
        sort: 'email',
        order: 'asc',
        status: 'blocked',
        q: 'ada',
        cursor,
      } as any);

      expect(users.findPage).toHaveBeenCalledWith({
        q: 'ada',
        status: 'blocked',
        sort: 'email',
        order: 'asc',
        limit: 5,
        after: { value: 'a@example.com', id: SELF_ID },
      });
      expect(page.nextCursor).toBe(encodeUserListCursor('email', 'asc', key));
    });

    it('rejects a cursor issued for another sort', async () => {
      const cursor = encodeUserListCursor('email', 'asc', {
        value: 'a@example.com',
        id: SELF_ID,
      });

      await expect(
        service.listUsers(ADMIN_ID, { ...baseQuery, cursor } as any),
      ).rejects.toThrow(BadRequestException);
      expect(users.findPage).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    it('applies a partial patch of self-editable fields only', async () => {
      await service.updateProfile(SELF_ID, SELF_ID, {
        firstName: 'Grace',
        bio: null,
      } as any);

      expect(users.update).toHaveBeenCalledWith(SELF_ID, {
        firstName: 'Grace',
        bio: null,
      });
      expect(users.setPassword).not.toHaveBeenCalled();
      expect(avatars.remove).not.toHaveBeenCalled();
    });

    it("denies updating another user's profile to a non-admin", async () => {
      await expect(
        service.updateProfile(SELF_ID, OTHER_ID, { firstName: 'X' } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it.each([
      ['email', { email: 'x@example.com' }],
      ['isEmailVerified', { isEmailVerified: false }],
      ['failedLoginAttempts', { failedLoginAttempts: 0 }],
      ['lockedUntil', { lockedUntil: null }],
      ['password', { password: 'N3w-Passw0rd!' }],
    ])('rejects the admin-only field %s for self', async (_field, dto) => {
      await expect(
        service.updateProfile(SELF_ID, SELF_ID, dto as any),
      ).rejects.toThrow(ForbiddenException);
      expect(users.update).not.toHaveBeenCalled();
      expect(users.setPassword).not.toHaveBeenCalled();
    });

    it('returns 404 when the target does not exist', async () => {
      await expect(
        service.updateProfile(
          ADMIN_ID,
          '00000000-0000-4000-8000-0000000000ff',
          { firstName: 'X' } as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an empty update', async () => {
      await expect(
        service.updateProfile(SELF_ID, SELF_ID, {} as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('lets an admin set every field and re-hashes the password', async () => {
      const profile = await service.updateProfile(ADMIN_ID, OTHER_ID, {
        email: 'renamed@example.com',
        isEmailVerified: false,
        failedLoginAttempts: 0,
        lockedUntil: '2026-02-01T00:00:00.000Z',
        locale: 'de',
        password: 'N3w-Passw0rd!',
      } as any);

      expect(users.update).toHaveBeenCalledWith(OTHER_ID, {
        locale: 'de',
        email: 'renamed@example.com',
        isEmailVerified: false,
        failedLoginAttempts: 0,
        lockedUntil: new Date('2026-02-01T00:00:00.000Z'),
      });
      expect(users.setPassword).toHaveBeenCalledWith(OTHER_ID, 'N3w-Passw0rd!');
      expect(profile).toHaveProperty('failedLoginAttempts');
    });

    it('accepts a password-only patch and clears lockedUntil', async () => {
      await service.updateProfile(ADMIN_ID, OTHER_ID, {
        password: 'N3w-Passw0rd!',
      } as any);
      await service.updateProfile(ADMIN_ID, OTHER_ID, {
        lockedUntil: null,
      } as any);

      expect(users.update).toHaveBeenNthCalledWith(1, OTHER_ID, {});
      expect(users.update).toHaveBeenNthCalledWith(2, OTHER_ID, {
        lockedUntil: null,
      });
      expect(users.setPassword).toHaveBeenCalledTimes(1);
    });

    it('skips the uniqueness check when the email is unchanged', async () => {
      await service.updateProfile(ADMIN_ID, OTHER_ID, {
        email: 'other@example.com',
      } as any);

      expect(users.getUserByEmail).not.toHaveBeenCalled();
    });

    it('rejects an email already used by someone else', async () => {
      await expect(
        service.updateProfile(ADMIN_ID, OTHER_ID, {
          email: 'self@example.com',
        } as any),
      ).rejects.toThrow(ConflictException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('stores a new avatar and removes the previous file', async () => {
      store.set(SELF_ID, makeUser({ photo: '/static/avatars/old.png' }));
      const photo = { buffer: Buffer.from('x') } as Express.Multer.File;

      await service.updateProfile(SELF_ID, SELF_ID, {} as any, photo);

      expect(avatars.validate).toHaveBeenCalledWith(photo);
      expect(avatars.save).toHaveBeenCalledWith(photo, 'png');
      expect(users.update).toHaveBeenCalledWith(SELF_ID, {
        photo: '/static/avatars/new.png',
      });
      expect(avatars.remove).toHaveBeenCalledWith('/static/avatars/old.png');
    });

    it('maps a unique violation to 409 and removes the fresh avatar', async () => {
      users.update.mockRejectedValueOnce(uniqueViolation());
      const photo = { buffer: Buffer.from('x') } as Express.Multer.File;

      await expect(
        service.updateProfile(
          ADMIN_ID,
          OTHER_ID,
          { email: 'race@example.com' } as any,
          photo,
        ),
      ).rejects.toThrow(ConflictException);
      expect(avatars.remove).toHaveBeenCalledWith('/static/avatars/new.png');
    });

    it('rethrows other persistence errors', async () => {
      const failure = new Error('db down');

      users.update.mockRejectedValueOnce(failure);

      await expect(
        service.updateProfile(SELF_ID, SELF_ID, { firstName: 'X' } as any),
      ).rejects.toBe(failure);
      expect(avatars.remove).toHaveBeenCalledWith(null);
    });
  });

  describe('email change', () => {
    it('issues the OTP for the new address and mails it there', async () => {
      const challenge = await service.requestEmailChange(SELF_ID, SELF_ID, {
        newEmail: 'new@example.com',
      });

      expect(users.issueOtp).toHaveBeenCalledWith(
        SELF_ID,
        OtpPurpose.EmailChange,
        'new@example.com',
      );
      expect(mail.sendEmailChangeEmail).toHaveBeenCalledWith(
        'new@example.com',
        'Ada Lovelace',
        '123456',
        EXPIRES_AT,
      );
      expect(challenge).toEqual({
        requiresConfirmation: true,
        challengeId: CHALLENGE_ID,
        expiresAt: EXPIRES_AT.toISOString(),
      });
    });

    it('greets by email when the user has no name', async () => {
      store.set(SELF_ID, makeUser({ firstName: null, lastName: null }));

      await service.requestEmailChange(SELF_ID, SELF_ID, {
        newEmail: 'new@example.com',
      });

      expect(mail.sendEmailChangeEmail.mock.calls[0][1]).toBe(
        'self@example.com',
      );
    });

    it('is self only, even for an admin', async () => {
      await expect(
        service.requestEmailChange(ADMIN_ID, SELF_ID, {
          newEmail: 'new@example.com',
        }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.confirmEmailChange(ADMIN_ID, SELF_ID, {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects the current address and an occupied one', async () => {
      await expect(
        service.requestEmailChange(SELF_ID, SELF_ID, {
          newEmail: 'self@example.com',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.requestEmailChange(SELF_ID, SELF_ID, {
          newEmail: 'other@example.com',
        }),
      ).rejects.toThrow(ConflictException);
      expect(users.issueOtp).not.toHaveBeenCalled();
    });

    it('returns 404 when the user is gone', async () => {
      store.delete(SELF_ID);

      await expect(
        service.requestEmailChange(SELF_ID, SELF_ID, {
          newEmail: 'new@example.com',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 503 when the mail cannot be sent', async () => {
      mail.sendEmailChangeEmail.mockRejectedValueOnce(new Error('smtp'));

      await expect(
        service.requestEmailChange(SELF_ID, SELF_ID, {
          newEmail: 'new@example.com',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('swaps the address on confirmation', async () => {
      const result = await service.confirmEmailChange(SELF_ID, SELF_ID, {
        challengeId: CHALLENGE_ID,
        code: '123456',
      });

      expect(users.verifyOtpChallenge).toHaveBeenCalledWith(
        CHALLENGE_ID,
        SELF_ID,
        OtpPurpose.EmailChange,
        '123456',
      );
      expect(users.update).toHaveBeenCalledWith(SELF_ID, {
        email: 'new@example.com',
        isEmailVerified: true,
      });
      expect(result).toEqual({
        message: 'Email updated successfully',
        email: 'new@example.com',
      });
    });

    it('rejects a stale or reused challenge', async () => {
      users.verifyOtpChallenge.mockRejectedValueOnce(
        new NotFoundException('Challenge not found'),
      );
      users.verifyOtpChallenge.mockRejectedValueOnce(
        new BadRequestException('Otp expired'),
      );

      await expect(
        service.confirmEmailChange(SELF_ID, SELF_ID, {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.confirmEmailChange(SELF_ID, SELF_ID, {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('treats a challenge without a new address as not found', async () => {
      users.verifyOtpChallenge.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        newEmail: null,
      });

      await expect(
        service.confirmEmailChange(SELF_ID, SELF_ID, {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects confirmation when the address was taken meanwhile', async () => {
      users.verifyOtpChallenge.mockResolvedValueOnce({
        id: CHALLENGE_ID,
        newEmail: 'other@example.com',
      });

      await expect(
        service.confirmEmailChange(SELF_ID, SELF_ID, {
          challengeId: CHALLENGE_ID,
          code: '123456',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a racing unique violation to 409 and rethrows others', async () => {
      const dto = { challengeId: CHALLENGE_ID, code: '123456' };
      const failure = new Error('db down');

      users.update.mockRejectedValueOnce(uniqueViolation());
      await expect(
        service.confirmEmailChange(SELF_ID, SELF_ID, dto),
      ).rejects.toThrow(ConflictException);

      users.update.mockRejectedValueOnce(failure);
      await expect(
        service.confirmEmailChange(SELF_ID, SELF_ID, dto),
      ).rejects.toBe(failure);
    });
  });

  describe('deletion', () => {
    const confirm = { challengeId: CHALLENGE_ID, code: '123456' };

    it('self DELETE only issues a challenge mailed to the account address', async () => {
      const result = await service.deleteUser(SELF_ID, SELF_ID, {});

      expect(users.issueOtp).toHaveBeenCalledWith(
        SELF_ID,
        OtpPurpose.AccountDeletion,
      );
      expect(mail.sendAccountDeletionEmail).toHaveBeenCalledWith(
        'self@example.com',
        'Ada Lovelace',
        '123456',
        EXPIRES_AT,
      );
      expect(users.delete).not.toHaveBeenCalled();
      expect(result).toEqual({
        requiresConfirmation: true,
        challengeId: CHALLENGE_ID,
        expiresAt: EXPIRES_AT.toISOString(),
        message: 'Deletion OTP code sent to your email address',
      });
    });

    it('an admin deleting themself also goes through the OTP flow', async () => {
      const result = await service.deleteUser(ADMIN_ID, ADMIN_ID, {
        reason: 'ignored',
      });

      expect(result).toHaveProperty('requiresConfirmation', true);
      expect(users.delete).not.toHaveBeenCalled();
    });

    it('returns 404 for a self deletion of a vanished user', async () => {
      store.delete(SELF_ID);

      await expect(service.deleteUser(SELF_ID, SELF_ID, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 503 when the deletion code cannot be sent', async () => {
      mail.sendAccountDeletionEmail.mockRejectedValueOnce(new Error('smtp'));

      await expect(service.deleteUser(SELF_ID, SELF_ID, {})).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("denies deleting another user's account without users@delete", async () => {
      await expect(service.deleteUser(SELF_ID, OTHER_ID, {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(rbac.can).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete' }),
      );
      expect(users.delete).not.toHaveBeenCalled();
    });

    it('admin deletion runs the cleanup sequence and logs the reason', async () => {
      store.set(
        OTHER_ID,
        makeUser({ id: OTHER_ID, photo: '/static/avatars/o.png' }),
      );

      const result = await service.deleteUser(ADMIN_ID, OTHER_ID, {
        reason: 'spam',
      });

      expect(users.delete).toHaveBeenCalledWith(OTHER_ID);
      expect(rbac.invalidate).toHaveBeenCalled();
      expect(avatars.remove).toHaveBeenCalledWith('/static/avatars/o.png');
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('mode=admin reason="spam"'),
      );
      expect(result).toEqual({
        message: 'User account deleted',
        userId: OTHER_ID,
      });
    });

    it('admin deletion of an unknown user is 404', async () => {
      await expect(
        service.deleteUser(
          ADMIN_ID,
          '00000000-0000-4000-8000-0000000000ff',
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 when the row disappeared before the delete', async () => {
      users.delete.mockResolvedValueOnce(false);

      await expect(service.deleteUser(ADMIN_ID, OTHER_ID, {})).rejects.toThrow(
        NotFoundException,
      );
      expect(rbac.invalidate).not.toHaveBeenCalled();
    });

    it('confirmation verifies the code then deletes the account', async () => {
      const result = await service.confirmDeletion(SELF_ID, SELF_ID, confirm);

      expect(users.verifyOtpChallenge).toHaveBeenCalledWith(
        CHALLENGE_ID,
        SELF_ID,
        OtpPurpose.AccountDeletion,
        '123456',
      );
      expect(users.delete).toHaveBeenCalledWith(SELF_ID);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining('mode=self'),
      );
      expect(result).toEqual({
        message: 'User account deleted',
        userId: SELF_ID,
      });
    });

    it('confirmation is self only', async () => {
      await expect(
        service.confirmDeletion(ADMIN_ID, SELF_ID, confirm),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a rejected code keeps the account and releases the lock', async () => {
      users.verifyOtpChallenge.mockRejectedValueOnce(
        new BadRequestException('Invalid verification code'),
      );

      await expect(
        service.confirmDeletion(SELF_ID, SELF_ID, confirm),
      ).rejects.toThrow(BadRequestException);
      expect(users.delete).not.toHaveBeenCalled();

      await expect(
        service.confirmDeletion(SELF_ID, SELF_ID, confirm),
      ).resolves.toHaveProperty('userId', SELF_ID);
    });

    it('rejects a concurrent deletion of the same user with 409', async () => {
      let release!: () => void;

      users.delete.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            release = () => resolve(true);
          }),
      );

      const first = service.confirmDeletion(SELF_ID, SELF_ID, confirm);

      await new Promise((resolve) => setImmediate(resolve));

      await expect(service.deleteUser(SELF_ID, SELF_ID, {})).rejects.toThrow(
        ConflictException,
      );
      await expect(service.deleteUser(ADMIN_ID, SELF_ID, {})).rejects.toThrow(
        ConflictException,
      );

      release();
      await expect(first).resolves.toHaveProperty('userId', SELF_ID);
    });
  });
});
