import { Request } from 'express';
import { TokenType } from '@/modules/auth/auth.types';

export interface TokenPayload {
  sub: string;
  email: string;
  type: TokenType;
}

export interface AuthenticatedRequest extends Request {
  user: TokenPayload;
}
