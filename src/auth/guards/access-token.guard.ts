import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { ACCESS_TOKEN_TYPE } from '../auth.constants';
import { AuthenticatedRequest, TokenPayload } from '../auth.types';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    let payload: TokenPayload;

    try {
      payload = this.jwtService.verify<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('invalidToken');
    }

    if (payload.type !== ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedException('invalidToken');
    }

    request.user = payload;

    return true;
  }

  private extractToken(request: Request): string {
    const [scheme, token, ...rest] =
      request.headers.authorization?.trim().split(/\s+/) ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
      throw new UnauthorizedException('Token is required');
    }

    return token;
  }
}
