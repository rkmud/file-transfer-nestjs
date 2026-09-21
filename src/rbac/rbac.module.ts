import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '@/auth/auth.module';
import { UsersModule } from '@/users/users.module';
import { RbacGrantsController } from './controllers/rbac-grants.controller';
import { RbacPermissionsController } from './controllers/rbac-permissions.controller';
import { RbacRolesController } from './controllers/rbac-roles.controller';
import { RbacUserRolesController } from './controllers/rbac-user-roles.controller';
import { Grant } from './entities/grant.entity';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { RbacAuditService } from './rbac.audit.service';
import { RbacService } from './rbac.service';
import { RbacStorageService } from './rbac.storage.service';
import { RbacGuard } from './guards/rbac.guard';
import { RbacGrantsService } from './services/rbac-grants.service';
import { RbacPermissionsService } from './services/rbac-permissions.service';
import { RbacRolesService } from './services/rbac-roles.service';
import { RbacUserRolesService } from './services/rbac-user-roles.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role, Permission, Grant, UserRole]),
    AuthModule,
    UsersModule,
  ],
  controllers: [
    RbacRolesController,
    RbacPermissionsController,
    RbacGrantsController,
    RbacUserRolesController,
  ],
  providers: [
    RbacStorageService,
    RbacService,
    RbacGuard,
    RbacAuditService,
    RbacRolesService,
    RbacPermissionsService,
    RbacGrantsService,
    RbacUserRolesService,
  ],
  exports: [TypeOrmModule, RbacStorageService, RbacService, RbacGuard],
})
export class RbacModule {}
