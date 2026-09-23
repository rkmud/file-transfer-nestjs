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
  ApiBadRequestResponse,
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
import { CreateGrantDto } from '../dto/create-grant.dto';
import { GrantResponseDto } from '../dto/rbac-response.dto';
import { UpdateGrantDto } from '../dto/update-grant.dto';
import { RbacGuard } from '../guards/rbac.guard';
import { ApiRbacAdmin } from '../decorators/api-rbac-admin.decorator';
import { RbacPermissions } from '../decorators/rbac-permissions.decorator';
import { RBAC_ADMIN_PERMISSIONS } from '../rbac.constants';
import { GrantView } from '../rbac.types';
import { RbacGrantsService } from '../services/rbac-grants.service';

@ApiTags('RBAC / Grants')
@ApiRbacAdmin()
@Controller('admin/rbac/grants')
@UseGuards(AccessTokenGuard, RbacGuard)
export class RbacGrantsController {
  constructor(private grantsService: RbacGrantsService) {}

  @Get()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.read)
  @ApiOperation({ summary: 'List grants' })
  @ApiOkResponse({ type: [GrantResponseDto] })
  findAll(): Promise<GrantView[]> {
    return this.grantsService.findAll();
  }

  @Post()
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.create)
  @ApiOperation({
    summary: 'Grant a permission to a role',
    description:
      'Omit "actions" to grant the permission as a whole, or list a subset of the actions the permission declares.',
  })
  @ApiCreatedResponse({ type: GrantResponseDto })
  @ApiBadRequestResponse({
    description: 'Actions are not declared by the permission',
  })
  @ApiNotFoundResponse({ description: 'Role or permission not found' })
  @ApiConflictResponse({
    description: 'The role already has a grant for this permission',
  })
  create(
    @CurrentUser() user: TokenPayload,
    @Body() dto: CreateGrantDto,
  ): Promise<GrantView> {
    return this.grantsService.create(user.sub, dto);
  }

  @Put(':id')
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.update)
  @ApiOperation({ summary: 'Update a grant' })
  @ApiOkResponse({ type: GrantResponseDto })
  @ApiBadRequestResponse({
    description: 'Actions are not declared by the permission',
  })
  @ApiNotFoundResponse({ description: 'Grant, role or permission not found' })
  @ApiConflictResponse({
    description: 'The role already has a grant for this permission',
  })
  update(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGrantDto,
  ): Promise<GrantView> {
    return this.grantsService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RbacPermissions(RBAC_ADMIN_PERMISSIONS.delete)
  @ApiOperation({ summary: 'Revoke a grant' })
  @ApiNoContentResponse({ description: 'Grant revoked' })
  @ApiNotFoundResponse({ description: 'Grant not found' })
  remove(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.grantsService.remove(user.sub, id);
  }
}
