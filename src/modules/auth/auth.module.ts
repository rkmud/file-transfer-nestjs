import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { AuthTokenModule } from '@/common/auth-token/auth-token.module';
import { MailModule } from '@/mail/mail.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthCookieService],
  imports: [UsersModule, MailModule, AuthTokenModule, RbacModule],
  exports: [AuthService],
})
export class AuthModule {}
