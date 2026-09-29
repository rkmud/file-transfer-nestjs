import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { diskStorage } from 'multer';
import { AuthTokenModule } from '@/common/auth-token/auth-token.module';
import {
  ConversionConfig,
  ImageConversionConfig,
} from '@/core/config/configuration';
import { TransformationHistoryModule } from '@/modules/transformation-history/transformation-history.module';
import { UsersModule } from '@/modules/users/users.module';
import { ConversionController } from './conversion.controller';
import { Conversion } from './entities/conversion.entity';
import {
  createFormatRegistry,
  FormatRegistry,
} from './formats/format-registry';
import {
  createImageFormatRegistry,
  ImageFormatRegistry,
} from './images/image-format-registry';
import { ImageConversionController } from './image-conversion.controller';
import {
  ConversionStorage,
  LocalConversionStorage,
  resolveIncomingDirectory,
} from './services/conversion-storage.service';
import { ConversionWorkerPool } from './services/conversion-worker-pool.service';
import { ConversionService } from './services/conversion.service';
import {
  ImageConversionService,
  SharpImageConversionService,
} from './services/image-conversion.service';
import { ImageWorkerPool } from './services/image-worker-pool.service';
import { TextConversionService } from './services/text-conversion.service';

@Module({
  imports: [
    UsersModule,
    AuthTokenModule,
    TransformationHistoryModule,
    TypeOrmModule.forFeature([Conversion]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const conversion = config.getOrThrow<ConversionConfig>('conversion');
        const images =
          config.getOrThrow<ImageConversionConfig>('imageConversion');
        const directory = resolveIncomingDirectory(conversion);
        const maxSizes = [
          ...Object.values(conversion.maxSizes),
          ...Object.values(images.maxSizes),
        ];

        return {
          storage: diskStorage({
            destination: (_request, _file, callback) => {
              mkdir(directory, { recursive: true }).then(
                () => callback(null, directory),
                (error: Error) => callback(error, directory),
              );
            },
            filename: (_request, _file, callback) =>
              callback(null, randomUUID()),
          }),
          limits: {
            fileSize: Math.max(...maxSizes),
            files: 1,
            fields: 8,
            fieldSize: 1024,
          },
        };
      },
    }),
  ],
  controllers: [ConversionController, ImageConversionController],
  providers: [
    { provide: FormatRegistry, useFactory: createFormatRegistry },
    { provide: ConversionStorage, useClass: LocalConversionStorage },
    { provide: ConversionService, useClass: TextConversionService },
    ConversionWorkerPool,
    { provide: ImageFormatRegistry, useFactory: createImageFormatRegistry },
    { provide: ImageConversionService, useClass: SharpImageConversionService },
    ImageWorkerPool,
  ],
})
export class ConversionModule {}
