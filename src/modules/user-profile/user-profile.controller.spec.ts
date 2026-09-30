import { UserProfileController } from './user-profile.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('UserProfileController', () => {
  const actor = { sub: 'actor-id', email: 'a@example.com', type: 'access' };
  let service: Record<string, jest.Mock>;
  let cookies: { clearAuthCookies: jest.Mock };
  let controller: UserProfileController;

  beforeEach(() => {
    service = {
      listUsers: jest.fn(async () => 'list'),
      getProfile: jest.fn(async () => 'profile'),
      updateProfile: jest.fn(async () => 'updated'),
      requestEmailChange: jest.fn(async () => 'challenge'),
      confirmEmailChange: jest.fn(async () => 'confirmed'),
      deleteUser: jest.fn(async () => 'deletion'),
      confirmDeletion: jest.fn(async () => 'deleted'),
    };
    cookies = { clearAuthCookies: jest.fn() };
    controller = new UserProfileController(service as any, cookies as any);
  });

  it('delegates every route to the service with the actor id', async () => {
    const query = { limit: 20 } as any;
    const photo = {} as Express.Multer.File;

    await expect(controller.listUsers(actor as any, query)).resolves.toBe(
      'list',
    );
    await expect(controller.getProfile(actor as any, 'u')).resolves.toBe(
      'profile',
    );
    await expect(
      controller.updateProfile(actor as any, 'u', { bio: 'x' }, photo),
    ).resolves.toBe('updated');
    await expect(
      controller.requestEmailChange(actor as any, 'u', { newEmail: 'n' }),
    ).resolves.toBe('challenge');
    await expect(
      controller.confirmEmailChange(actor as any, 'u', {
        challengeId: 'c',
        code: '1',
      }),
    ).resolves.toBe('confirmed');
    await expect(
      controller.deleteUser(actor as any, 'u', { reason: 'r' }),
    ).resolves.toBe('deletion');

    expect(service.listUsers).toHaveBeenCalledWith('actor-id', query);
    expect(service.getProfile).toHaveBeenCalledWith('actor-id', 'u');
    expect(service.updateProfile).toHaveBeenCalledWith(
      'actor-id',
      'u',
      { bio: 'x' },
      photo,
    );
    expect(service.requestEmailChange).toHaveBeenCalledWith('actor-id', 'u', {
      newEmail: 'n',
    });
    expect(service.confirmEmailChange).toHaveBeenCalledWith('actor-id', 'u', {
      challengeId: 'c',
      code: '1',
    });
    expect(service.deleteUser).toHaveBeenCalledWith('actor-id', 'u', {
      reason: 'r',
    });
  });

  it('clears auth cookies only after a confirmed deletion', async () => {
    const res = {} as any;
    const dto = { challengeId: 'c', code: '123456' };

    await expect(
      controller.confirmDeletion(actor as any, 'u', dto, res),
    ).resolves.toBe('deleted');
    expect(cookies.clearAuthCookies).toHaveBeenCalledWith(res);

    cookies.clearAuthCookies.mockClear();
    service.confirmDeletion.mockRejectedValueOnce(new Error('bad code'));

    await expect(
      controller.confirmDeletion(actor as any, 'u', dto, res),
    ).rejects.toThrow('bad code');
    expect(cookies.clearAuthCookies).not.toHaveBeenCalled();
  });
});
