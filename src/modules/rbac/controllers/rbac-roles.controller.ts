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
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { CurrentUser } from '@/common/auth-token/current-user.decorator';
import { AccessTokenGuard } from '@/common/auth-token/access-token.guard';
import { CreateRoleDto } from '../dto/create-role.dto';
import { RoleResponseDto } from '../dto/rbac-response.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { Role } from '../entities/role.entity';
import { RbacGuard } from '../guards/rbac.guard';
import { ApiRbacAdmin } from '../decorators/api-rbac-admin.decorator';
import { RbacPermissions } from '../decorators/rbac-permissions.decorator';
import { RBAC_ADMIN_PERMISSIONS } from '../rbac.constants';
import { RbacRolesService } from '../services/rbac-roles.service';

@ApiTags('RBAC / Roles')
@ApiRbacAdmin()
@Controller('admin/rbac/roles')
@UseGuards(AccessTokenGuard, RbacGuard)
export class RbacRolesController {
  constructor(private rolesService: RbacRolesService) {}

  @Get()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.read)
  @ApiOperation({ summary: 'List roles' })
  @ApiOkResponse({ type: [RoleResponseDto] })
  findAll(): Promise<Role[]> {
    return this.rolesService.findAll();
  }

  @Post()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.create)
  @ApiOperation({ summary: 'Create a role' })
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiConflictResponse({ description: 'A role with this name already exists' })
  create(
    @CurrentUser() user: TokenPayload,
    @Body() dto: CreateRoleDto,
  ): Promise<Role> {
    return this.rolesService.create(user.sub, dto);
  }

  @Put(':id')
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.update)
  @ApiOperation({ summary: 'Update a role' })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiConflictResponse({ description: 'A role with this name already exists' })
  update(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<Role> {
    return this.rolesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.delete)
  @ApiOperation({ summary: 'Delete a role' })
  @ApiNoContentResponse({ description: 'Role deleted' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiConflictResponse({
    description: 'The role is still referenced by grants or user assignments',
  })
  remove(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.rolesService.remove(user.sub, id);
  }
}
