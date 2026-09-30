import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthCookieService } from './auth-cookie.service';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';

const ACCESS_MS = 15 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

const makeService = (cookie: { secure: boolean; domain?: string }) => {
  const values: Record<string, unknown> = {
    cookie,
    jwtAccessExpiresInMs: ACCESS_MS,
    jwtRefreshExpiresInMs: REFRESH_MS,
  };
  const config = {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;

  return new AuthCookieService(config);
};

const makeResponse = () =>
  ({ cookie: jest.fn(), clearCookie: jest.fn() }) as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };

describe('AuthCookieService', () => {
  const tokens = { accessToken: 'acc', refreshToken: 'ref' };

  it('sets httpOnly/lax/path=/ cookies with TTL-synchronised maxAge', () => {
    const res = makeResponse();

    makeService({ secure: false }).setAuthCookies(res, tokens);

    const base = {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      domain: undefined,
      path: '/',
    };

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.cookie).toHaveBeenCalledWith(ACCESS_TOKEN_COOKIE, 'acc', {
      ...base,
      maxAge: ACCESS_MS,
    });
    expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, 'ref', {
      ...base,
      maxAge: REFRESH_MS,
    });
  });

  it('honours secure and domain from the cookie config slice', () => {
    const res = makeResponse();

    makeService({ secure: true, domain: 'example.com' }).setAuthCookies(
      res,
      tokens,
    );

    for (const [, , options] of res.cookie.mock.calls) {
      expect(options).toMatchObject({
        secure: true,
        domain: 'example.com',
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    }
  });

  it('clears both cookies with the same attributes they were set with', () => {
    const res = makeResponse();

    makeService({ secure: true, domain: 'example.com' }).clearAuthCookies(res);

    const base = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      domain: 'example.com',
      path: '/',
    };

    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    expect(res.clearCookie).toHaveBeenCalledWith(ACCESS_TOKEN_COOKIE, base);
    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, base);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
