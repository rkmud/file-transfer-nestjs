import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '@/modules/users/users.service';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TYPE,
} from '@/modules/auth/auth.constants';
import { AuthenticatedRequest, TokenPayload } from './auth-token.types';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly logger = new Logger(AccessTokenGuard.name);

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    let payload: TokenPayload;

    try {
      payload = this.jwtService.verify<TokenPayload>(token);
    } catch (error) {
      this.logger.warn(
        `Access token validation failed: ${this.describe(error)}`,
      );

      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (payload.type !== ACCESS_TOKEN_TYPE) {
      this.logger.warn('Access token validation failed: wrong token type');

      throw new UnauthorizedException('Invalid or expired access token');
    }

    const user = await this.usersService.getUserById(payload.sub);

    if (!user || (user.lockedUntil && user.lockedUntil > new Date())) {
      this.logger.warn(
        `Access token validation failed: userId=${payload.sub} not found or inactive`,
      );

      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.user = payload;

    return true;
  }

  private extractToken(request: AuthenticatedRequest): string {
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE];

    if (!token) {
      throw new UnauthorizedException('Access token is required');
    }

    return token;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.name : 'unknown error';
  }
}
