import { ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE } from './auth.constants';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type TokenType = typeof ACCESS_TOKEN_TYPE | typeof REFRESH_TOKEN_TYPE;

export interface RequestMeta {
  ip: string;
  userAgent: string;
}

export interface PublicUser {
  id: string;
  email: string;
  isEmailVerified: boolean;
  createdAt: Date;
}

export interface VerificationRequired {
  verificationRequired: true;
  expiresAt: string;
  message: string;
}
export interface RegistrationResult extends VerificationRequired {
  user: PublicUser;
  tokens: AuthTokens;
}

export interface LoginResult {
  user: PublicUser;
  tokens: AuthTokens;
}

export interface VerifyEmailResult {
  user: PublicUser;
  message: string;
  tokens: AuthTokens;
}

export interface RefreshResult {
  tokens: AuthTokens;
}
