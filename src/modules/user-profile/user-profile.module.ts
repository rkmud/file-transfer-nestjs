import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthTokenModule } from '@/common/auth-token/auth-token.module';
import { UploadsConfig } from '@/core/config/configuration';
import { MailModule } from '@/mail/mail.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { UsersModule } from '@/modules/users/users.module';
import { AvatarStorageService } from './avatar-storage.service';
import { UserProfileController } from './user-profile.controller';
import { UserProfileService } from './user-profile.service';

@Module({
  imports: [
    UsersModule,
    AuthTokenModule,
    AuthModule,
    RbacModule,
    MailModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize:
            configService.getOrThrow<UploadsConfig>('uploads').avatarMaxBytes,
          files: 1,
        },
      }),
    }),
  ],
  controllers: [UserProfileController],
  providers: [UserProfileService, AvatarStorageService],
})
export class UserProfileModule {}
