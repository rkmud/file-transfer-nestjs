import { Module } from '@nestjs/common';
import { AuthTokenModule } from '@/common/auth-token/auth-token.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { UsersModule } from '@/modules/users/users.module';
import { UserProfileController } from './user-profile.controller';
import { UserProfileService } from './user-profile.service';

@Module({
  imports: [UsersModule, AuthTokenModule, RbacModule],
  controllers: [UserProfileController],
  providers: [UserProfileService],
})
export class UserProfileModule {}
