import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthTokenModule } from '@/common/auth-token/auth-token.module';
import { TransformationStorageConfig } from '@/core/config/configuration';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { UsersModule } from '@/modules/users/users.module';
import { AdminTransformationHistoryController } from './admin-transformation-history.controller';
import { TransformationLog } from './entities/transformation-log.entity';
import { LocalStorageService } from './storage/local-storage.service';
import { StorageService } from './storage/storage.service';
import { TransformationFileService } from './transformation-file.service';
import { TransformationHistoryController } from './transformation-history.controller';
import { TransformationHistoryService } from './transformation-history.service';
import { TransformationStorageCleanupScheduler } from './transformation-storage-cleanup.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransformationLog]),
    AuthTokenModule,
    RbacModule,
    UsersModule,
  ],
  controllers: [
    TransformationHistoryController,
    AdminTransformationHistoryController,
  ],
  providers: [
    TransformationHistoryService,
    TransformationFileService,
    TransformationStorageCleanupScheduler,
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        const { backend } = config.getOrThrow<TransformationStorageConfig>(
          'transformationStorage',
        );

        switch (backend) {
          case 'LOCAL_STORAGE':
            return new LocalStorageService(config);
        }
      },
    },
  ],
  exports: [TransformationHistoryService, TransformationFileService],
})
export class TransformationHistoryModule {}
