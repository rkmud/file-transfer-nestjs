import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SwaggerConfig } from '@/config/configuration';
import { SWAGGER_BEARER_AUTH } from './swagger.constants';

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
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token returned by registration or verification',
      },
      SWAGGER_BEARER_AUTH,
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
