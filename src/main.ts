import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { resolve } from 'path';
import { AppModule } from './core/app/app.module';
import { UploadsConfig } from './core/config/configuration';
import { setupSwagger } from './core/swagger/swagger.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );

  const configService = app.get(ConfigService);
  const uploads = configService.getOrThrow<UploadsConfig>('uploads');

  app.useStaticAssets(resolve(uploads.dir), { prefix: uploads.publicPrefix });

  setupSwagger(app);

  const port = configService.get('port');

  await app.listen(port);
}

void bootstrap();
