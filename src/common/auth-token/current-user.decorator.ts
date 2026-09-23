import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, TokenPayload } from './auth-token.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TokenPayload =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
