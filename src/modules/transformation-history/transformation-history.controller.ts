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
import {
  TransformationHistoryQueryDto,
  TransformationHistoryResponseDto,
} from './dto/transformation-history.dto';
import { TransformationFileService } from './transformation-file.service';
import { TransformationHistoryService } from './transformation-history.service';
import {
  TRANSFORMATION_DOWNLOAD_PRODUCES,
  toDownloadFile,
} from './transformation-download';
import { TransformationHistoryPage } from './transformation-history.types';

@ApiTags('Transformation history')
@ApiCookieAuth(SWAGGER_COOKIE_AUTH)
@Controller('transformations')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
export class TransformationHistoryController {
  constructor(
    private historyService: TransformationHistoryService,
    private fileService: TransformationFileService,
  ) {}

  @Get('history')
  @ApiOperation({
    summary: 'Own transformation history',
    description:
      'Cursor-paginated file and image transformations of the current user, newest first.',
  })
  @ApiOkResponse({ type: TransformationHistoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid limit, filter, ISO 8601 date or malformed cursor',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  getOwnHistory(
    @CurrentUser() user: TokenPayload,
    @Query() query: TransformationHistoryQueryDto,
  ): Promise<TransformationHistoryPage> {
    return this.historyService.listOwn(user.sub, query);
  }

  @Get('history/:itemId/download')
  @ApiOperation({
    summary: 'Download own saved transformation output',
    description:
      'Streams the output of a transformation that was requested with save=true, as transformed_<itemId>.<ext>, until its expiresAt.',
  })
  @ApiParam({ name: 'itemId', format: 'uuid', description: 'History item' })
  @ApiProduces(...TRANSFORMATION_DOWNLOAD_PRODUCES)
  @ApiOkResponse({
    description: 'Saved output file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'itemId is not a UUID' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({
    description: 'The history item belongs to another user',
  })
  @ApiNotFoundResponse({
    description: 'History item not found, or its output was not saved',
  })
  @ApiGoneResponse({
    description: 'The saved output has expired and was purged',
  })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
  async downloadOwn(
    @CurrentUser() user: TokenPayload,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<StreamableFile> {
    return toDownloadFile(
      await this.fileService.download(user.sub, itemId, { kind: 'self' }),
    );
  }
}
