import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from '../config/configuration';
import { createThrottlerOptions } from './throttler.options';
import { DatabaseModule } from '../../database/database.module';
import { HealthModule } from '../health/health.module';
import { UsersModule } from '../../modules/users/users.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { RbacModule } from '../../modules/rbac/rbac.module';
import { UserProfileModule } from '../../modules/user-profile/user-profile.module';
import { ConversionModule } from '../../modules/conversion/conversion.module';
import { TransformationHistoryModule } from '../../modules/transformation-history/transformation-history.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createThrottlerOptions,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    RbacModule,
    UserProfileModule,
    ConversionModule,
    TransformationHistoryModule,
  ],
})
export class AppModule {}
