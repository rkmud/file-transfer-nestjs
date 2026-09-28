import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { diskStorage } from 'multer';
import { AuthTokenModule } from '@/common/auth-token/auth-token.module';
import { ConversionConfig } from '@/core/config/configuration';
import { UsersModule } from '@/modules/users/users.module';
import { ConversionController } from './conversion.controller';
import { Conversion } from './entities/conversion.entity';
import {
  createFormatRegistry,
  FormatRegistry,
} from './formats/format-registry';
import {
  ConversionStorage,
  LocalConversionStorage,
  resolveIncomingDirectory,
} from './services/conversion-storage.service';
import { ConversionWorkerPool } from './services/conversion-worker-pool.service';
import { ConversionService } from './services/conversion.service';
import { TextConversionService } from './services/text-conversion.service';

@Module({
  imports: [
    UsersModule,
    AuthTokenModule,
    TypeOrmModule.forFeature([Conversion]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const conversion = config.getOrThrow<ConversionConfig>('conversion');
        const directory = resolveIncomingDirectory(conversion);
        const { maxSizes } = conversion;

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
            fileSize: Math.max(...Object.values(maxSizes)),
            files: 1,
            fields: 5,
            fieldSize: 1024,
          },
        };
      },
    }),
  ],
  controllers: [ConversionController],
  providers: [
    { provide: FormatRegistry, useFactory: createFormatRegistry },
    { provide: ConversionStorage, useClass: LocalConversionStorage },
    { provide: ConversionService, useClass: TextConversionService },
    ConversionWorkerPool,
  ],
})
export class ConversionModule {}
