import { applyDecorators } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SWAGGER_COOKIE_AUTH } from '@/core/swagger/swagger.constants';

export const ApiRbacAdmin = () =>
  applyDecorators(
    ApiCookieAuth(SWAGGER_COOKIE_AUTH),
    ApiUnauthorizedResponse({ description: 'Missing or invalid access token' }),
    ApiForbiddenResponse({
      description: 'The user lacks the required rbac permission',
    }),
  );
