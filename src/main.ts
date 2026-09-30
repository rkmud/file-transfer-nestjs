import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'path';
import { AppModule } from './core/app/app.module';
import { configureApp } from './core/app/app.setup';
import { UploadsConfig } from './core/config/configuration';
import { setupSwagger } from './core/swagger/swagger.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureApp(app);

  const configService = app.get(ConfigService);
  const uploads = configService.getOrThrow<UploadsConfig>('uploads');

  app.useStaticAssets(resolve(uploads.dir), { prefix: uploads.publicPrefix });

  setupSwagger(app);

  const port = configService.get('port');

  await app.listen(port);
}

void bootstrap();
