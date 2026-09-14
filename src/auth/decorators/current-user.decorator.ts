import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, TokenPayload } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TokenPayload =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
