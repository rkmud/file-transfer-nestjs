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
import { TokenPayload } from '@/auth/auth.types';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '@/auth/guards/access-token.guard';
import { CreatePermissionDto } from '../dto/create-permission.dto';
import { PermissionResponseDto } from '../dto/rbac-response.dto';
import { UpdatePermissionDto } from '../dto/update-permission.dto';
import { Permission } from '../entities/permission.entity';
import { RbacGuard } from '../guards/rbac.guard';
import { ApiRbacAdmin } from '../decorators/api-rbac-admin.decorator';
import { RbacPermissions } from '../decorators/rbac-permissions.decorator';
import { RBAC_ADMIN_PERMISSIONS } from '../rbac.constants';
import { RbacPermissionsService } from '../services/rbac-permissions.service';

@ApiTags('RBAC / Permissions')
@ApiRbacAdmin()
@Controller('admin/rbac/permissions')
@UseGuards(AccessTokenGuard, RbacGuard)
export class RbacPermissionsController {
  constructor(private permissionsService: RbacPermissionsService) {}

  @Get()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.read)
  @ApiOperation({ summary: 'List permissions' })
  @ApiOkResponse({ type: [PermissionResponseDto] })
  findAll(): Promise<Permission[]> {
    return this.permissionsService.findAll();
  }

  @Post()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.create)
  @ApiOperation({ summary: 'Create a permission' })
  @ApiCreatedResponse({ type: PermissionResponseDto })
  @ApiConflictResponse({
    description: 'A permission with this name already exists',
  })
  create(
    @CurrentUser() user: TokenPayload,
    @Body() dto: CreatePermissionDto,
  ): Promise<Permission> {
    return this.permissionsService.create(user.sub, dto);
  }

  @Put(':id')
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.update)
  @ApiOperation({
    summary: 'Update a permission',
    description:
      'Actions still used by existing grants cannot be removed from the permission.',
  })
  @ApiOkResponse({ type: PermissionResponseDto })
  @ApiNotFoundResponse({ description: 'Permission not found' })
  @ApiConflictResponse({
    description:
      'The name is taken, or removed actions are still used by grants',
  })
  update(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
  ): Promise<Permission> {
    return this.permissionsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.delete)
  @ApiOperation({ summary: 'Delete a permission' })
  @ApiNoContentResponse({ description: 'Permission deleted' })
  @ApiNotFoundResponse({ description: 'Permission not found' })
  @ApiConflictResponse({
    description: 'The permission is still referenced by grants',
  })
  remove(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.permissionsService.remove(user.sub, id);
  }
}
