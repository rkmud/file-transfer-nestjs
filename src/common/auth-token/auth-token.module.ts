import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@/modules/users/users.module';
import { AccessTokenGuard } from './access-token.guard';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwtSecret'),
        signOptions: {
          issuer: config.getOrThrow<string>('jwtIssuer'),
          audience: config.getOrThrow<string>('jwtAudience'),
        },
        verifyOptions: {
          issuer: config.getOrThrow<string>('jwtIssuer'),
          audience: config.getOrThrow<string>('jwtAudience'),
        },
      }),
    }),
  ],
  providers: [AccessTokenGuard],
  exports: [JwtModule, AccessTokenGuard],
})
export class AuthTokenModule {}
