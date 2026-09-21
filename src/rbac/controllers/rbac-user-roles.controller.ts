import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { TokenPayload } from '@/auth/auth.types';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '@/auth/guards/access-token.guard';
import { AssignRoleDto } from '../dto/assign-role.dto';
import { UserRoleResponseDto } from '../dto/rbac-response.dto';
import { RbacGuard } from '../guards/rbac.guard';
import { ApiRbacAdmin } from '../decorators/api-rbac-admin.decorator';
import { RbacPermissions } from '../decorators/rbac-permissions.decorator';
import { RBAC_ADMIN_PERMISSIONS } from '../rbac.constants';
import { UserRoleView } from '../rbac.types';
import { RbacUserRolesService } from '../services/rbac-user-roles.service';

@ApiTags('RBAC / User roles')
@ApiRbacAdmin()
@ApiParam({ name: 'userId', format: 'uuid', description: 'Target user' })
@Controller('admin/rbac/users/:userId/roles')
@UseGuards(AccessTokenGuard, RbacGuard)
export class RbacUserRolesController {
  constructor(private userRolesService: RbacUserRolesService) {}

  @Get()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.read)
  @ApiOperation({ summary: 'List the roles assigned to a user' })
  @ApiOkResponse({ type: [UserRoleResponseDto] })
  @ApiNotFoundResponse({ description: 'User not found' })
  findAll(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserRoleView[]> {
    return this.userRolesService.findAll(userId);
  }

  @Post()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.create)
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiCreatedResponse({ type: UserRoleResponseDto })
  @ApiNotFoundResponse({ description: 'User or role not found' })
  @ApiConflictResponse({ description: 'The user already has this role' })
  assign(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignRoleDto,
  ): Promise<UserRoleView> {
    return this.userRolesService.assign(user.sub, userId, dto);
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.delete)
  @ApiOperation({ summary: 'Revoke a role from a user' })
  @ApiParam({ name: 'roleId', format: 'uuid', description: 'Role to revoke' })
  @ApiNoContentResponse({ description: 'Role revoked' })
  @ApiNotFoundResponse({ description: 'Role assignment not found' })
  revoke(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.userRolesService.revoke(user.sub, userId, roleId);
  }
}
