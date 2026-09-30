import { UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { AuthCookieService } from './auth-cookie.service';
import { AuthController } from './auth.controller';
import { REFRESH_TOKEN_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('AuthController', () => {
  const tokens = { accessToken: 'acc', refreshToken: 'ref' };
  const user = {
    id: 'u1',
    email: 'a@example.com',
    isEmailVerified: false,
    createdAt: new Date(0),
  };
  const current: TokenPayload = {
    sub: 'u1',
    email: 'a@example.com',
    type: 'access',
  };
  let authService: Record<string, jest.Mock>;
  let cookies: { setAuthCookies: jest.Mock; clearAuthCookies: jest.Mock };
  let controller: AuthController;
  const res = {} as Response;

  beforeEach(() => {
    authService = {
      registration: jest.fn(async () => ({
        user,
        tokens,
        verificationRequired: true,
        expiresAt: 'x',
        message: 'm',
      })),
      verifyEmail: jest.fn(async () => ({ user, tokens, message: 'ok' })),
      resendOtp: jest.fn(async () => ({ verificationRequired: true })),
      login: jest.fn(async () => ({ user, tokens })),
      refreshTokens: jest.fn(async () => ({ tokens })),
    };
    cookies = { setAuthCookies: jest.fn(), clearAuthCookies: jest.fn() };
    controller = new AuthController(
      authService as unknown as AuthService,
      cookies as unknown as AuthCookieService,
    );
  });

  const request = (overrides: Record<string, any> = {}) =>
    ({
      ip: '1.2.3.4',
      headers: { 'user-agent': 'jest-agent' },
      socket: { remoteAddress: '9.9.9.9' },
      cookies: {},
      ...overrides,
    }) as unknown as Request;

  it('registration sets cookies and strips tokens from the body', async () => {
    const body = await controller.registration(
      { email: 'a@example.com', password: 'p' },
      res,
    );

    expect(cookies.setAuthCookies).toHaveBeenCalledWith(res, tokens);
    expect(body).not.toHaveProperty('tokens');
    expect(body).toMatchObject({ user, verificationRequired: true });
  });

  it('verifyEmail uses the current user id, sets fresh cookies, strips tokens', async () => {
    const body = await controller.verifyEmail(current, { otp: '123456' }, res);

    expect(authService.verifyEmail).toHaveBeenCalledWith('u1', {
      otp: '123456',
    });
    expect(cookies.setAuthCookies).toHaveBeenCalledWith(res, tokens);
    expect(body).toEqual({ user, message: 'ok' });
  });

  it('resendOtp delegates with the current user id', async () => {
    await expect(controller.resendOtp(current)).resolves.toEqual({
      verificationRequired: true,
    });
    expect(authService.resendOtp).toHaveBeenCalledWith('u1');
  });

  it('login passes request metadata, sets cookies, strips tokens', async () => {
    const body = await controller.login(
      { email: 'a@example.com', password: 'p' },
      request(),
      res,
    );

    expect(authService.login).toHaveBeenCalledWith(
      { email: 'a@example.com', password: 'p' },
      { ip: '1.2.3.4', userAgent: 'jest-agent' },
    );
    expect(cookies.setAuthCookies).toHaveBeenCalledWith(res, tokens);
    expect(body).toEqual({ user });
  });

  it.each([
    [{ ip: undefined }, { ip: '9.9.9.9', userAgent: 'jest-agent' }],
    [
      { ip: undefined, socket: {}, headers: {} },
      { ip: 'unknown', userAgent: 'unknown' },
    ],
  ])('falls back for request metadata %p', async (overrides, meta) => {
    await controller.login(
      { email: 'a@example.com', password: 'p' },
      request(overrides),
      res,
    );

    expect(authService.login).toHaveBeenCalledWith(expect.anything(), meta);
  });

  describe('refresh', () => {
    it('rotates both cookies on a valid refresh cookie', async () => {
      await expect(
        controller.refresh(
          request({ cookies: { [REFRESH_TOKEN_COOKIE]: 'r' } }),
          res,
        ),
      ).resolves.toEqual({ message: 'Tokens refreshed' });

      expect(authService.refreshTokens).toHaveBeenCalledWith('r', {
        ip: '1.2.3.4',
        userAgent: 'jest-agent',
      });
      expect(cookies.setAuthCookies).toHaveBeenCalledWith(res, tokens);
      expect(cookies.clearAuthCookies).not.toHaveBeenCalled();
    });

    it.each([[{ cookies: {} }], [{ cookies: undefined }]])(
      'clears cookies and 401s without a refresh cookie (%p)',
      async (overrides) => {
        await expect(
          controller.refresh(request(overrides), res),
        ).rejects.toThrow(
          new UnauthorizedException('Refresh token is required'),
        );
        expect(cookies.clearAuthCookies).toHaveBeenCalledWith(res);
        expect(authService.refreshTokens).not.toHaveBeenCalled();
      },
    );

    it('clears cookies and rethrows when the service rejects the token', async () => {
      const error = new UnauthorizedException('nope');

      authService.refreshTokens.mockRejectedValueOnce(error);

      await expect(
        controller.refresh(
          request({ cookies: { [REFRESH_TOKEN_COOKIE]: 'r' } }),
          res,
        ),
      ).rejects.toBe(error);
      expect(cookies.clearAuthCookies).toHaveBeenCalledWith(res);
      expect(cookies.setAuthCookies).not.toHaveBeenCalled();
    });
  });

  it('logout clears both cookies', () => {
    expect(controller.logout(res)).toEqual({
      message: 'Logged out successfully',
    });
    expect(cookies.clearAuthCookies).toHaveBeenCalledWith(res);
  });
});
