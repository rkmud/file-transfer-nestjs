import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { MailModule } from '@/mail/mail.module';
import { OtpModule } from '@/otp/otp.module';
import { UsersModule } from '@/users/users.module';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard],
  imports: [
    UsersModule,
    MailModule,
    OtpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwtSecret'),
      }),
    }),
  ],
  exports: [AuthService, AccessTokenGuard, JwtModule],
})
export class AuthModule {}
