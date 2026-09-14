import { Request } from 'express';
import { ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE } from './auth.constants';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type TokenType = typeof ACCESS_TOKEN_TYPE | typeof REFRESH_TOKEN_TYPE;

export interface TokenPayload {
  sub: string;
  email: string;
  type: TokenType;
}

export interface AuthenticatedRequest extends Request {
  user: TokenPayload;
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

export interface RegistrationResult extends AuthTokens, VerificationRequired {
  user: PublicUser;
}
