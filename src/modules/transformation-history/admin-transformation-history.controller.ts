import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '@/common/auth-token/access-token.guard';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { CurrentUser } from '@/common/auth-token/current-user.decorator';
import { SWAGGER_COOKIE_AUTH } from '@/core/swagger/swagger.constants';
import { RbacPermissions } from '@/modules/rbac/decorators/rbac-permissions.decorator';
import { RbacGuard } from '@/modules/rbac/guards/rbac.guard';
import {
  AdminTransformationHistoryQueryDto,
  TransformationHistoryQueryDto,
  TransformationHistoryResponseDto,
} from './dto/transformation-history.dto';
import { TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION } from './transformation-history.constants';
import {
  TRANSFORMATION_DOWNLOAD_PRODUCES,
  toDownloadFile,
} from './transformation-download';
import { TransformationFileService } from './transformation-file.service';
import { TransformationHistoryService } from './transformation-history.service';
import { TransformationHistoryPage } from './transformation-history.types';

@ApiTags('Transformation history')
@ApiCookieAuth(SWAGGER_COOKIE_AUTH)
@Controller('admin')
@UseGuards(ThrottlerGuard, AccessTokenGuard, RbacGuard)
@RbacPermissions(TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({
  description: `The user lacks the ${TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION} permission`,
})
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
export class AdminTransformationHistoryController {
  constructor(
    private historyService: TransformationHistoryService,
    private fileService: TransformationFileService,
  ) {}

  @Get('transformations/history')
  @ApiOperation({
    summary: 'Platform-wide transformation history',
    description: `Admins only (${TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION}). Transformations of all users, newest first, optionally narrowed to one user via userId.`,
  })
  @ApiOkResponse({ type: TransformationHistoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid limit, filter, ISO 8601 date, userId or cursor',
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  getGlobalHistory(
    @CurrentUser() user: TokenPayload,
    @Query() query: AdminTransformationHistoryQueryDto,
  ): Promise<TransformationHistoryPage> {
    return this.historyService.listForAdmin(user.sub, query, query.userId);
  }

  @Get('users/:userId/transformations/history')
  @ApiOperation({
    summary: 'Transformation history of a user',
    description: `Admins only (${TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION}).`,
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Target user' })
  @ApiOkResponse({ type: TransformationHistoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid limit, filter, ISO 8601 date, userId or cursor',
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  getUserHistory(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: TransformationHistoryQueryDto,
  ): Promise<TransformationHistoryPage> {
    return this.historyService.listForAdmin(user.sub, query, userId);
  }

  @Get('transformations/history/:itemId/download')
  @ApiOperation({
    summary: 'Download any saved transformation output',
    description: `Admins only (${TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION}). Streams the saved output of any user's transformation.`,
  })
  @ApiParam({ name: 'itemId', format: 'uuid', description: 'History item' })
  @ApiProduces(...TRANSFORMATION_DOWNLOAD_PRODUCES)
  @ApiOkResponse({
    description: 'Saved output file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'itemId is not a UUID' })
  @ApiNotFoundResponse({
    description: 'History item not found, or its output was not saved',
  })
  @ApiGoneResponse({
    description: 'The saved output has expired and was purged',
  })
  async downloadAny(
    @CurrentUser() user: TokenPayload,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<StreamableFile> {
    return toDownloadFile(
      await this.fileService.download(user.sub, itemId, { kind: 'admin' }),
    );
  }

  @Get('users/:userId/transformations/history/:itemId/download')
  @ApiOperation({
    summary: "Download a user's saved transformation output",
    description: `Admins only (${TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION}). The history item must belong to userId.`,
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'Target user' })
  @ApiParam({ name: 'itemId', format: 'uuid', description: 'History item' })
  @ApiProduces(...TRANSFORMATION_DOWNLOAD_PRODUCES)
  @ApiOkResponse({
    description: 'Saved output file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'userId or itemId is not a UUID' })
  @ApiNotFoundResponse({
    description:
      'History item not found for this user, or its output was not saved',
  })
  @ApiGoneResponse({
    description: 'The saved output has expired and was purged',
  })
  async downloadUsers(
    @CurrentUser() user: TokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<StreamableFile> {
    return toDownloadFile(
      await this.fileService.download(user.sub, itemId, {
        kind: 'admin',
        userId,
      }),
    );
  }
}
