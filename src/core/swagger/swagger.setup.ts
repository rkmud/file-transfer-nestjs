import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SwaggerConfig } from '@/core/config/configuration';
import { SWAGGER_COOKIE_AUTH } from './swagger.constants';

export const setupSwagger = (app: INestApplication): void => {
  const configService = app.get(ConfigService);
  const { enabled, path } = configService.getOrThrow<SwaggerConfig>('swagger');

  if (!enabled) {
    return;
  }

  const config = new DocumentBuilder()
    .setTitle('File Transfer API')
    .setDescription(
      'Registration with email verification, RBAC administration and health checks.',
    )
    .setVersion('1.0')
    .addCookieAuth(
      'access_token',
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'HttpOnly access_token cookie set by login, registration, email verification or refresh',
      },
      SWAGGER_COOKIE_AUTH,
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(path, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      defaultModelsExpandDepth: -1,
    },
    jsonDocumentUrl: `${path}/json`,
  });

  Logger.log(`Swagger UI is available at /${path}`, 'Swagger');
};
