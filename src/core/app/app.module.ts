import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration, { ThrottleConfig } from '../config/configuration';
import { DatabaseModule } from '../../database/database.module';
import { HealthModule } from '../health/health.module';
import { UsersModule } from '../../modules/users/users.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { RbacModule } from '../../modules/rbac/rbac.module';
import { UserProfileModule } from '../../modules/user-profile/user-profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { ttlSeconds, limit, blockSeconds } =
          configService.getOrThrow<ThrottleConfig>('throttle');

        return {
          throttlers: [
            {
              ttl: ttlSeconds * 1000,
              limit,
              blockDuration: blockSeconds * 1000,
            },
          ],
        };
      },
    }),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    RbacModule,
    UserProfileModule,
  ],
})
export class AppModule {}
