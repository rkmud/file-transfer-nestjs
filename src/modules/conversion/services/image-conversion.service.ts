import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImageConversionConfig } from '@/core/config/configuration';
import {
  CONVERSION_OUTPUT_BASENAME,
  IMAGE_DEFAULT_BACKGROUND,
  IMAGE_DEFAULT_JPEG_QUALITY,
  IMAGE_SNIFF_BYTES,
} from '../conversion.constants';
import {
  ConversionResult,
  ImageConversionDirections,
  ImageConversionRequest,
} from '../conversion.types';
import { sanitizeFileName } from '../conversion.utils';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from '../entities/conversion.entity';
import { ImageConversionError } from '../images/image-conversion-error';
import { detectImageFormat } from '../images/image-format-detector';
import {
  ImageFormatHandler,
  RasterFormatHandler,
} from '../images/image-format-handler';
import { ImageFormatRegistry } from '../images/image-format-registry';
import {
  ImageConversionErrorCode,
  ImageLimits,
  ImageTransformOptions,
} from '../images/image-format.types';
import { ConversionStorage, OutputTarget } from './conversion-storage.service';
import { ImageWorkerPool } from './image-worker-pool.service';
import { ConversionTimeoutError } from './worker-pool';

const ERROR_STATUS: Record<ImageConversionErrorCode, HttpStatus> = {
  UNSUPPORTED_FORMAT: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  VECTORIZATION_NOT_SUPPORTED: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_DIRECTION: HttpStatus.BAD_REQUEST,
  FILE_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  INVALID_IMAGE: HttpStatus.BAD_REQUEST,
  SVG_SANITY_FAILED: HttpStatus.BAD_REQUEST,
  EXCEEDED_MAX_DIMENSIONS: HttpStatus.BAD_REQUEST,
  EXCEEDED_MAX_PIXELS: HttpStatus.BAD_REQUEST,
  TIMEOUT: HttpStatus.REQUEST_TIMEOUT,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

interface OperationContext {
  record: Conversion;
  startedAt: number;
}

export abstract class ImageConversionService {
  abstract getSupportedFormats(): ImageConversionDirections[];
  abstract convert(request: ImageConversionRequest): Promise<ConversionResult>;
}

@Injectable()
export class SharpImageConversionService extends ImageConversionService {
  private readonly logger = new Logger(SharpImageConversionService.name);

  constructor(
    @InjectRepository(Conversion)
    private conversionRepository: Repository<Conversion>,
    private registry: ImageFormatRegistry,
    private storage: ConversionStorage,
    private workerPool: ImageWorkerPool,
    private configService: ConfigService,
  ) {
    super();
  }

  getSupportedFormats(): ImageConversionDirections[] {
    return this.registry.all().map((source) => ({
      source: source.format,
      target: this.registry.targetsFor(source).map((target) => target.format),
    }));
  }

  async convert(request: ImageConversionRequest): Promise<ConversionResult> {
    const { userId, file, targetFormat } = request;

    if (!file || file.size === 0) {
      await this.storage.remove(file?.path);

      throw new BadRequestException('File is required and must not be empty');
    }

    const context: OperationContext = {
      record: await this.conversionRepository.save(
        this.conversionRepository.create({
          userId,
          type: ConversionType.Image,
          inputFileName: sanitizeFileName(file.originalname),
          inputSize: file.size,
          outputFormat: targetFormat,
          status: ConversionStatus.Processing,
        }),
      ),
      startedAt: Date.now(),
    };

    let inputPath: string | undefined;
    let output: OutputTarget | undefined;

    try {
      const source = await this.resolveSource(context, file);
      const target = this.registry.resolveTarget(
        source,
        this.registry.get(targetFormat),
      );
      const options = this.resolveOptions(request, source);
      const limits = this.getLimits();

      if (source.kind === 'vector') {
        this.assertRequestedDimensions(options, limits);
      }

      inputPath = await this.storage.storeInput(
        file.path,
        userId,
        context.record.id,
        source.extensions[0],
      );
      context.record.inputPath = this.storage.toRelative(inputPath);

      output = await this.storage.prepareOutput(
        userId,
        context.record.id,
        target.extensions[0],
      );

      const result = await this.workerPool.run({
        inputPath,
        outputPath: output.tempPath,
        sourceFormat: source.format,
        targetFormat: target.format,
        options,
        limits,
      });

      if (!result.ok) {
        throw new ImageConversionError(result.code, result.message);
      }

      await this.storage.commitOutput(output);

      const fileName = this.outputFileName(target);

      await this.complete(context, ConversionStatus.Success, {
        outputFileName: fileName,
        outputPath: this.storage.toRelative(output.finalPath),
        outputSize: result.outputSize,
      });

      return {
        stream: this.storage.openRead(output.finalPath),
        mimeType: target.mimeType,
        fileName,
        size: result.outputSize,
      };
    } catch (error) {
      const { exception, reason } = this.toHttpException(error);

      await this.storage.remove(output?.tempPath);

      if (reason === 'TIMEOUT') {
        // The abandoned worker can still finish writing after the delete above.
        void this.storage.removeLingering(output?.tempPath);
      }

      if (!inputPath) {
        await this.storage.remove(file.path);
      }

      await this.complete(context, ConversionStatus.Error, {
        errorCode: exception.getStatus(),
        errorReason: reason,
      });

      throw exception;
    }
  }

  private async resolveSource(
    { record }: OperationContext,
    file: Express.Multer.File,
  ): Promise<ImageFormatHandler> {
    const head = await this.storage.readHead(file.path, IMAGE_SNIFF_BYTES);
    const source = detectImageFormat(
      this.registry,
      record.inputFileName,
      file.mimetype,
      head,
    );

    record.inputFormat = source.format;

    const limit =
      this.getConfig().maxSizes[source.format] ?? Number.POSITIVE_INFINITY;

    if (file.size > limit) {
      throw new ImageConversionError(
        'FILE_TOO_LARGE',
        `${source.format.toUpperCase()} files are limited to ${limit} bytes`,
      );
    }

    return source;
  }

  private resolveOptions(
    request: ImageConversionRequest,
    source: ImageFormatHandler,
  ): ImageTransformOptions {
    return {
      quality: request.quality ?? IMAGE_DEFAULT_JPEG_QUALITY,
      width: request.width,
      height: request.height,
      // The canvas color is a rasterization parameter: raster sources keep the
      // default background their encoder flattens transparency onto.
      background:
        source.kind === 'vector'
          ? (request.background ?? IMAGE_DEFAULT_BACKGROUND)
          : IMAGE_DEFAULT_BACKGROUND,
    };
  }

  private assertRequestedDimensions(
    { width, height }: ImageTransformOptions,
    { maxRasterWidth, maxRasterHeight }: ImageLimits,
  ): void {
    if ((width ?? 0) > maxRasterWidth || (height ?? 0) > maxRasterHeight) {
      throw new ImageConversionError(
        'EXCEEDED_MAX_DIMENSIONS',
        `Requested size exceeds the ${maxRasterWidth}x${maxRasterHeight} px limit`,
      );
    }
  }

  private outputFileName(target: RasterFormatHandler): string {
    return `${CONVERSION_OUTPUT_BASENAME}${target.extensions[0]}`;
  }

  private toHttpException(error: unknown): {
    exception: HttpException;
    reason: ImageConversionErrorCode;
  } {
    if (error instanceof ConversionTimeoutError) {
      return {
        exception: new HttpException(
          `Conversion exceeded the ${this.getConfig().timeoutMs} ms time limit`,
          HttpStatus.REQUEST_TIMEOUT,
        ),
        reason: 'TIMEOUT',
      };
    }

    if (error instanceof ImageConversionError && error.code !== 'INTERNAL') {
      const statusCode = ERROR_STATUS[error.code];

      return {
        exception: new HttpException(
          { statusCode, code: error.code, message: error.message },
          statusCode,
        ),
        reason: error.code,
      };
    }

    return {
      exception: new HttpException(
        'Conversion failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      ),
      reason: 'INTERNAL',
    };
  }

  private async complete(
    { record, startedAt }: OperationContext,
    status: ConversionStatus,
    changes: Partial<Conversion>,
  ): Promise<void> {
    const durationMs = Date.now() - startedAt;

    Object.assign(record, changes, {
      status,
      durationMs,
      completedAt: new Date(),
    });

    const summary = `userId=${record.userId} sourceFormat=${record.inputFormat ?? 'unknown'} targetFormat=${record.outputFormat} fileSize=${record.inputSize} executionTimeMs=${durationMs}`;

    if (status === ConversionStatus.Success) {
      this.logger.log(
        `Image conversion succeeded: ${summary} result=SUCCESS httpStatusCode=200`,
      );
    } else {
      this.logger.warn(
        `Image conversion failed: ${summary} result=ERROR httpStatusCode=${record.errorCode} errorCode=${record.errorReason}`,
      );
    }

    try {
      await this.conversionRepository.save(record);
    } catch {
      this.logger.error(
        `Failed to record conversion history: conversionId=${record.id}`,
      );
    }
  }

  private getLimits(): ImageLimits {
    const { maxInputPixels, maxRasterWidth, maxRasterHeight } =
      this.getConfig();

    return { maxInputPixels, maxRasterWidth, maxRasterHeight };
  }

  private getConfig(): ImageConversionConfig {
    return this.configService.getOrThrow<ImageConversionConfig>(
      'imageConversion',
    );
  }
}
