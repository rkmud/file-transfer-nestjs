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
        secret: config.get<string>('jwtSecret'),
        signOptions: {
          issuer: config.get<string>('jwtIssuer'),
          audience: config.get<string>('jwtAudience'),
        },
        verifyOptions: {
          issuer: config.get<string>('jwtIssuer'),
          audience: config.get<string>('jwtAudience'),
        },
      }),
    }),
  ],
  providers: [AccessTokenGuard],
  exports: [JwtModule, AccessTokenGuard],
})
export class AuthTokenModule {}
