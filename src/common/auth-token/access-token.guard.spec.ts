import {
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '@/modules/users/users.service';
import { User } from '@/modules/users/users.entity';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TYPE,
  REFRESH_TOKEN_TYPE,
} from '@/modules/auth/auth.constants';
import { FakeClock, useFakeClock } from '../../../test/setup/clock';
import { AccessTokenGuard } from './access-token.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SECRET = 'guard-spec-secret';
const OPTIONS = { issuer: 'iss', audience: 'aud' };

describe('AccessTokenGuard', () => {
  let jwt: JwtService;
  let usersService: { getUserById: jest.Mock };
  let guard: AccessTokenGuard;
  let clock: FakeClock;
  let user: Partial<User>;

  let warn: jest.SpyInstance;

  beforeEach(() => {
    clock = useFakeClock();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jwt = new JwtService({
      secret: SECRET,
      signOptions: OPTIONS,
      verifyOptions: OPTIONS,
    });
    user = { id: 'user-1', email: 'a@example.com', lockedUntil: null };
    usersService = {
      getUserById: jest.fn(async (id: string) =>
        id === user.id ? user : null,
      ),
    };
    guard = new AccessTokenGuard(jwt, usersService as unknown as UsersService);
  });

  afterEach(() => {
    clock.restore();
    jest.restoreAllMocks();
  });

  const sign = (claims: Record<string, unknown> = {}, service = jwt) =>
    service.sign({
      sub: 'user-1',
      email: 'a@example.com',
      type: ACCESS_TOKEN_TYPE,
      ...claims,
    });

  const contextFor = (request: Record<string, any>) => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { ctx, request };
  };

  const withCookie = (token: string) =>
    contextFor({ cookies: { [ACCESS_TOKEN_COOKIE]: token }, headers: {} });

  it('accepts a valid access cookie and attaches the payload to request.user', async () => {
    const { ctx, request } = withCookie(sign());

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      sub: 'user-1',
      email: 'a@example.com',
      type: ACCESS_TOKEN_TYPE,
    });
    expect(usersService.getUserById).toHaveBeenCalledWith('user-1');
  });

  it('does not accept an Authorization: Bearer header', async () => {
    const { ctx } = contextFor({
      headers: { authorization: `Bearer ${sign()}` },
      cookies: {},
    });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Access token is required',
    );
  });

  it('rejects a request with no cookies object at all', async () => {
    const { ctx } = contextFor({ headers: {} });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it.each([
    ['malformed', () => 'not-a-jwt'],
    [
      'wrong secret',
      () => sign({}, new JwtService({ secret: 'other', signOptions: OPTIONS })),
    ],
    [
      'wrong issuer',
      () =>
        sign(
          {},
          new JwtService({
            secret: SECRET,
            signOptions: { ...OPTIONS, issuer: 'evil' },
          }),
        ),
    ],
    ['wrong type (refresh)', () => sign({ type: REFRESH_TOKEN_TYPE })],
  ])('rejects a %s token with 401', async (_label, token) => {
    const { ctx, request } = withCookie(token());

    const value = token();

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException('Invalid or expired access token'),
    );
    expect(request.user).toBeUndefined();
    // Diagnostics are logged, the token string itself never is.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).not.toContain(value);
  });

  it('rejects an expired token (faked clock)', async () => {
    const token = jwt.sign(
      { sub: 'user-1', email: 'a@example.com', type: ACCESS_TOKEN_TYPE },
      { expiresIn: '15m' },
    );

    clock.advance(15 * 60 * 1000 + 1000);

    await expect(guard.canActivate(withCookie(token).ctx)).rejects.toThrow(
      'Invalid or expired access token',
    );
  });

  it('describes non-Error verification failures as unknown', async () => {
    jest.spyOn(jwt, 'verify').mockImplementationOnce(() => {
      throw 'boom';
    });

    await expect(guard.canActivate(withCookie('x').ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose user no longer exists', async () => {
    const token = sign({ sub: 'deleted-user' });

    await expect(guard.canActivate(withCookie(token).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a currently locked user and accepts once the lock elapsed', async () => {
    user.lockedUntil = new Date(clock.now().getTime() + 60_000);
    const token = sign();

    await expect(guard.canActivate(withCookie(token).ctx)).rejects.toThrow(
      UnauthorizedException,
    );

    clock.advance(60_000);

    await expect(guard.canActivate(withCookie(token).ctx)).resolves.toBe(true);
  });
});
