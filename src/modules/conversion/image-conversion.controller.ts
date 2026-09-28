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
import { ImageConversionDirections } from './conversion.types';
import {
  ConvertImageBodyDto,
  ConvertImageDto,
  ImageConversionDirectionsResponseDto,
} from './dto/convert-image.dto';
import { UploadCleanupInterceptor } from './interceptors/upload-cleanup.interceptor';
import { ImageConversionService } from './services/image-conversion.service';

export interface ImageConversionEndpoint {
  getFormats(): ImageConversionDirections[];
  convert(
    user: TokenPayload,
    dto: ConvertImageDto,
    file?: Express.Multer.File,
  ): Promise<StreamableFile>;
}

@ApiTags('Image conversion')
@ApiCookieAuth(SWAGGER_COOKIE_AUTH)
@Controller('images/convert')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
export class ImageConversionController implements ImageConversionEndpoint {
  constructor(private imageConversionService: ImageConversionService) {}

  @Get('formats')
  @ApiOperation({ summary: 'List supported image conversion directions' })
  @ApiOkResponse({ type: ImageConversionDirectionsResponseDto, isArray: true })
  getFormats(): ImageConversionDirections[] {
    return this.imageConversionService.getSupportedFormats();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor(CONVERSION_FILE_FIELD),
    UploadCleanupInterceptor,
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ConvertImageBodyDto })
  @ApiProduces('image/png', 'image/jpeg')
  @ApiOperation({
    summary: 'Convert an image',
    description:
      'Converts PNG ↔ JPEG and rasterizes SVG to PNG/JPEG. The source format is detected from the file signature and checked against the extension and MIME type; per-format size limits apply. Vectorization (PNG/JPEG → SVG) is not supported. The result is streamed back as an attachment named converted.<ext>.',
  })
  @ApiOkResponse({
    description: 'Converted image',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({
    description:
      'Missing/empty file, invalid parameters, corrupted image, unsafe or malformed SVG, vectorization attempt, or output/pixel limits exceeded',
  })
  @ApiPayloadTooLargeResponse({
    description: 'File exceeds the size limit for its format',
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'File signature, extension or MIME type is not PNG, JPEG or SVG',
  })
  @ApiRequestTimeoutResponse({ description: 'Conversion took too long' })
  async convert(
    @CurrentUser() user: TokenPayload,
    @Body() dto: ConvertImageDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<StreamableFile> {
    const result = await this.imageConversionService.convert({
      userId: user.sub,
      file,
      ...dto,
    });

    return new StreamableFile(result.stream, {
      type: result.mimeType,
      disposition: `attachment; filename="${result.fileName}"`,
      length: result.size,
    });
  }
}
