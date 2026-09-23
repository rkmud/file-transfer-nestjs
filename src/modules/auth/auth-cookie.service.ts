import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Response } from 'express';
import { CookieConfig } from '@/core/config/configuration';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { AuthTokens } from './auth.types';

@Injectable()
export class AuthCookieService {
  constructor(private configService: ConfigService) {}

  setAuthCookies(res: Response, tokens: AuthTokens): void {
    const base = this.baseCookieOptions();

    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...base,
      maxAge: this.configService.getOrThrow<number>('jwtAccessExpiresInMs'),
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...base,
      maxAge: this.configService.getOrThrow<number>('jwtRefreshExpiresInMs'),
    });
  }

  clearAuthCookies(res: Response): void {
    const base = this.baseCookieOptions();

    res.clearCookie(ACCESS_TOKEN_COOKIE, base);
    res.clearCookie(REFRESH_TOKEN_COOKIE, base);
  }

  private baseCookieOptions(): CookieOptions {
    const { secure, domain } =
      this.configService.getOrThrow<CookieConfig>('cookie');

    return {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      domain,
      path: '/',
    };
  }
}
