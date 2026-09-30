import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
  RequestTimeoutException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversionConfig } from '@/core/config/configuration';
import { TransformationFileService } from '@/modules/transformation-history/transformation-file.service';
import { TransformationHistoryService } from '@/modules/transformation-history/transformation-history.service';
import {
  CONVERSION_OUTPUT_BASENAME,
  CONVERSION_SNIFF_BYTES,
} from '../conversion.constants';
import {
  ConversionDirections,
  ConversionRequest,
  ConversionResult,
} from '../conversion.types';
import { sanitizeFileName, toTransformationLog } from '../conversion.utils';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from '../entities/conversion.entity';
import { ConversionError } from '../formats/conversion-error';
import { detectSourceFormat } from '../formats/format-detector';
import { TextFormatHandler } from '../formats/format-handler';
import { FormatRegistry } from '../formats/format-registry';
import { ConversionErrorCode, TextFormat } from '../formats/format.types';
import { ConversionTaskResult } from '../worker/conversion.task';
import { ConversionStorage, OutputTarget } from './conversion-storage.service';
import { ConversionService } from './conversion.service';
import {
  ConversionTimeoutError,
  ConversionWorkerPool,
} from './conversion-worker-pool.service';

const ERROR_STATUS: Record<ConversionErrorCode, HttpStatus> = {
  INVALID_ENCODING: HttpStatus.BAD_REQUEST,
  SYNTAX_ERROR: HttpStatus.BAD_REQUEST,
  LIMIT_EXCEEDED: HttpStatus.BAD_REQUEST,
  FORBIDDEN_CONSTRUCT: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_FORMAT: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

const HTTP_ERROR_REASON: Partial<Record<number, string>> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'FILE_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_FORMAT',
};

interface OperationContext {
  record: Conversion;
  startedAt: number;
  sourceFormat?: TextFormat;
}

@Injectable()
export class TextConversionService extends ConversionService {
  private readonly logger = new Logger(TextConversionService.name);

  constructor(
    @InjectRepository(Conversion)
    private conversionRepository: Repository<Conversion>,
    private registry: FormatRegistry,
    private storage: ConversionStorage,
    private workerPool: ConversionWorkerPool,
    private configService: ConfigService,
    private historyService: TransformationHistoryService,
    private fileService: TransformationFileService,
  ) {
    super();
  }

  getSupportedFormats(): ConversionDirections[] {
    const formats = this.registry.all().map((handler) => handler.format);

    return formats.map((source) => ({
      source,
      target: formats.filter((target) => target !== source),
    }));
  }

  async convert({
    userId,
    file,
    targetFormat,
    save,
  }: ConversionRequest): Promise<ConversionResult> {
    if (!file || file.size === 0) {
      await this.storage.remove(file?.path);

      throw new BadRequestException('File is required and must not be empty');
    }

    const target = targetFormat.trim().toLowerCase();

    if (!this.registry.has(target)) {
      await this.storage.remove(file.path);

      throw new UnsupportedMediaTypeException(
        `Unsupported target format "${target}"`,
      );
    }

    const context: OperationContext = {
      record: await this.conversionRepository.save(
        this.conversionRepository.create({
          userId,
          type: ConversionType.File,
          inputFileName: sanitizeFileName(file.originalname),
          inputSize: file.size,
          outputFormat: target,
          status: ConversionStatus.Processing,
        }),
      ),
      startedAt: Date.now(),
    };

    let inputPath: string | undefined;
    let output: OutputTarget | undefined;

    try {
      const source = await this.resolveSource(context, file, target);
      const targetHandler = this.registry.get(target);

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
        targetHandler.extensions[0],
      );

      const result = await this.workerPool.run({
        inputPath,
        inputSize: file.size,
        outputPath: output.tempPath,
        sourceFormat: source.format,
        targetFormat: target,
        limits: this.getParseLimits(),
        streamThresholdBytes: this.getConfig().streamThresholdBytes,
      });

      this.assertSucceeded(result);
      await this.storage.commitOutput(output);

      const fileName = `${CONVERSION_OUTPUT_BASENAME}${targetHandler.extensions[0]}`;

      await this.complete(context, ConversionStatus.Success, {
        outputFileName: fileName,
        outputPath: this.storage.toRelative(output.finalPath),
        outputSize: result.outputSize,
      });

      if (save) {
        this.saveOutput(context, targetHandler.extensions[0], output.finalPath);
      }

      return {
        stream: this.storage.openRead(output.finalPath),
        mimeType: `${targetHandler.mimeType}; charset=utf-8`,
        fileName,
        size: result.outputSize,
      };
    } catch (error) {
      const exception = this.toHttpException(error);

      await this.storage.remove(output?.tempPath);

      if (error instanceof ConversionTimeoutError) {
        this.storage.removeLingering(output?.tempPath);
      }

      if (!inputPath) {
        await this.storage.remove(file.path);
      }

      await this.complete(context, ConversionStatus.Error, {
        errorCode: exception.getStatus(),
        errorReason: this.toErrorReason(error, exception),
      });

      throw exception;
    }
  }

  private async resolveSource(
    context: OperationContext,
    file: Express.Multer.File,
    target: TextFormat,
  ): Promise<TextFormatHandler> {
    const head = await this.storage.readHead(file.path, CONVERSION_SNIFF_BYTES);
    const source = detectSourceFormat(
      this.registry,
      context.record.inputFileName,
      head,
    );

    context.sourceFormat = source.format;
    context.record.inputFormat = source.format;

    if (source.format === target) {
      throw new UnsupportedMediaTypeException(
        `Conversion from ${source.format} to ${target} is not supported`,
      );
    }

    const limit =
      this.getConfig().maxSizes[source.format] ?? Number.POSITIVE_INFINITY;

    if (file.size > limit) {
      throw new PayloadTooLargeException(
        `${source.format.toUpperCase()} files are limited to ${limit} bytes`,
      );
    }

    return source;
  }

  private assertSucceeded(
    result: ConversionTaskResult,
  ): asserts result is Extract<ConversionTaskResult, { ok: true }> {
    if (!result.ok) {
      throw new ConversionError(result.code, result.message);
    }
  }

  private toHttpException(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    if (error instanceof ConversionTimeoutError) {
      return new RequestTimeoutException(
        `Conversion exceeded the ${this.getConfig().timeoutMs} ms time limit`,
      );
    }

    if (error instanceof ConversionError && error.code !== 'INTERNAL') {
      return new HttpException(error.message, ERROR_STATUS[error.code]);
    }

    return new InternalServerErrorException('Conversion failed');
  }

  private toErrorReason(error: unknown, exception: HttpException): string {
    if (error instanceof ConversionTimeoutError) {
      return 'TIMEOUT';
    }

    if (error instanceof ConversionError) {
      return error.code;
    }

    return HTTP_ERROR_REASON[exception.getStatus()] ?? 'INTERNAL';
  }

  private async complete(
    { record, startedAt, sourceFormat }: OperationContext,
    status: ConversionStatus,
    changes: Partial<Conversion>,
  ): Promise<void> {
    const durationMs = Date.now() - startedAt;

    Object.assign(record, changes, {
      status,
      durationMs,
      completedAt: new Date(),
    });

    const summary = `userId=${record.userId} sourceFormat=${sourceFormat ?? 'unknown'} targetFormat=${record.outputFormat} fileSize=${record.inputSize} durationMs=${durationMs}`;

    if (status === ConversionStatus.Success) {
      this.logger.log(`Conversion succeeded: ${summary} result=success`);
    } else {
      this.logger.warn(
        `Conversion failed: ${summary} result=error code=${record.errorCode}`,
      );
    }

    try {
      await this.conversionRepository.save(record);
    } catch {
      this.logger.error(
        `Failed to record conversion history: conversionId=${record.id}`,
      );
    }

    await this.historyService.record(toTransformationLog(record));
  }

  private saveOutput(
    { record }: OperationContext,
    extension: string,
    outputPath: string,
  ): void {
    void this.fileService.persist({
      id: record.id,
      userId: record.userId,
      targetFormat: record.outputFormat,
      extension,
      createdAt: record.createdAt,
      open: () => this.storage.openRead(outputPath),
    });
  }

  private getParseLimits() {
    const { maxDepth, maxNodes, maxYamlAliases } = this.getConfig();

    return { maxDepth, maxNodes, maxYamlAliases };
  }

  private getConfig(): ConversionConfig {
    return this.configService.getOrThrow<ConversionConfig>('conversion');
  }
}
