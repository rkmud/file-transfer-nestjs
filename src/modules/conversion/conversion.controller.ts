import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiRequestTimeoutResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '@/common/auth-token/access-token.guard';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { CurrentUser } from '@/common/auth-token/current-user.decorator';
import { SWAGGER_COOKIE_AUTH } from '@/core/swagger/swagger.constants';
import { CONVERSION_FILE_FIELD } from './conversion.constants';
import { ConversionDirections } from './conversion.types';
import {
  ConversionDirectionsResponseDto,
  ConvertFileBodyDto,
  ConvertFileDto,
} from './dto/convert-file.dto';
import { UploadCleanupInterceptor } from './interceptors/upload-cleanup.interceptor';
import { ConversionService } from './services/conversion.service';

export interface ConversionEndpoint {
  getFormats(): ConversionDirections[];
  convert(
    user: TokenPayload,
    dto: ConvertFileDto,
    file?: Express.Multer.File,
  ): Promise<StreamableFile>;
}

@ApiTags('Conversion')
@ApiCookieAuth(SWAGGER_COOKIE_AUTH)
@Controller('convert')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
export class ConversionController implements ConversionEndpoint {
  constructor(private conversionService: ConversionService) {}

  @Get('formats')
  @ApiOperation({ summary: 'List supported conversion directions' })
  @ApiOkResponse({ type: ConversionDirectionsResponseDto, isArray: true })
  getFormats(): ConversionDirections[] {
    return this.conversionService.getSupportedFormats();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor(CONVERSION_FILE_FIELD),
    UploadCleanupInterceptor,
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ConvertFileBodyDto })
  @ApiProduces(
    'text/csv',
    'application/json',
    'application/xml',
    'application/yaml',
  )
  @ApiOperation({
    summary: 'Convert a text file',
    description:
      'Converts between CSV, JSON, XML and YAML. The source format is detected from the file extension and content; per-format size limits apply. Large CSV and top-level-array JSON inputs are converted record by record, so file size is not bounded by memory. The result is streamed back as an attachment named converted.<ext>. With save=true the output is also kept for download from the transformation history until it expires.',
  })
  @ApiOkResponse({
    description: 'Converted file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({
    description:
      'Missing/empty file, missing targetFormat, invalid encoding, syntax error or structure limits exceeded',
  })
  @ApiPayloadTooLargeResponse({
    description: 'File exceeds the size limit for its format',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'Unsupported or undetectable source format, or target format',
  })
  @ApiRequestTimeoutResponse({ description: 'Conversion took too long' })
  async convert(
    @CurrentUser() user: TokenPayload,
    @Body() dto: ConvertFileDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<StreamableFile> {
    const result = await this.conversionService.convert({
      userId: user.sub,
      file,
      targetFormat: dto.targetFormat,
      save: dto.save,
    });

    return new StreamableFile(result.stream, {
      type: result.mimeType,
      disposition: `attachment; filename="${result.fileName}"`,
      length: result.size,
    });
  }
}
