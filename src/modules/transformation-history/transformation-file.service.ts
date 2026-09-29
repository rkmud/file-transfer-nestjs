import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { posix } from 'path';
import { In, Repository } from 'typeorm';
import { TransformationStorageConfig } from '@/core/config/configuration';
import { TransformationLog } from './entities/transformation-log.entity';
import { StorageService } from './storage/storage.service';
import {
  TRANSFORMATION_DOWNLOAD_FILE_PREFIX,
  TRANSFORMATION_FALLBACK_MIME_TYPE,
  TRANSFORMATION_MIME_TYPES,
  TRANSFORMATION_STORAGE_ERROR_FULL,
  TRANSFORMATION_STORAGE_ERROR_WRITE,
  TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE,
} from './transformation-history.constants';
import {
  TransformationDownload,
  TransformationFormat,
  TransformationOutputInput,
  TransformationPurgeResult,
} from './transformation-history.types';

const DAY_MS = 24 * 60 * 60 * 1000;

export type TransformationDownloadScope =
  { kind: 'self' } | { kind: 'admin'; userId?: string };

@Injectable()
export class TransformationFileService {
  private readonly logger = new Logger(TransformationFileService.name);

  constructor(
    @InjectRepository(TransformationLog)
    private logRepository: Repository<TransformationLog>,
    private storage: StorageService,
    private configService: ConfigService,
  ) {}

  /**
   * Saves a finished transformation's output for later download. Meant to be
   * fired without awaiting after the response has been handed off, and never
   * throws: a storage failure is only recorded on the history row.
   */
  async persist(input: TransformationOutputInput): Promise<void> {
    const key = this.buildKey(input);
    const startedAt = Date.now();

    try {
      const { size } = await this.storage.put(key, input.open());
      const expiresAt = new Date(
        input.createdAt.getTime() + this.getConfig().retentionDays * DAY_MS,
      );
      const { affected } = await this.logRepository.update(
        { id: input.id },
        {
          isStored: true,
          storagePath: key,
          expiresAt,
          storageErrorCode: null,
        },
      );

      if (!affected) {
        // Without a history row the file could never be downloaded or purged.
        await this.storage.delete(key);
        this.logger.error(
          `Stored transformation output discarded, history record missing: transformationId=${input.id}`,
        );

        return;
      }

      this.logger.log(
        `Transformation output stored: transformationId=${input.id} userId=${input.userId} size=${size} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      const code =
        (error as NodeJS.ErrnoException).code === 'ENOSPC'
          ? TRANSFORMATION_STORAGE_ERROR_FULL
          : TRANSFORMATION_STORAGE_ERROR_WRITE;

      this.logger.error(
        `Failed to store transformation output: transformationId=${input.id} userId=${input.userId} storageErrorCode=${code}`,
      );

      try {
        await this.logRepository.update(
          { id: input.id },
          { isStored: false, storagePath: null, storageErrorCode: code },
        );
      } catch {
        this.logger.error(
          `Failed to record storage error: transformationId=${input.id}`,
        );
      }
    }
  }

  async download(
    actorUserId: string,
    itemId: string,
    scope: TransformationDownloadScope,
  ): Promise<TransformationDownload> {
    const log = await this.logRepository.findOneBy({ id: itemId });

    if (
      !log ||
      (scope.kind === 'admin' && scope.userId && log.userId !== scope.userId)
    ) {
      throw new NotFoundException('Transformation not found');
    }

    if (scope.kind === 'self' && log.userId !== actorUserId) {
      throw new ForbiddenException(
        'You do not have access to this transformation',
      );
    }

    if (!log.expiresAt) {
      throw new NotFoundException('No saved file for this transformation');
    }

    const object =
      log.isStored && log.storagePath && log.expiresAt > new Date()
        ? await this.storage.stat(log.storagePath)
        : null;

    if (!object || !log.storagePath) {
      throw new GoneException(
        'The saved file has expired and is no longer available',
      );
    }

    this.logger.log(
      `Transformation output downloaded: actorUserId=${actorUserId} scope=${scope.kind} transformationId=${log.id} userId=${log.userId}`,
    );

    return {
      stream: this.storage.openRead(log.storagePath),
      mimeType:
        TRANSFORMATION_MIME_TYPES[log.targetFormat as TransformationFormat] ??
        TRANSFORMATION_FALLBACK_MIME_TYPE,
      fileName: `${TRANSFORMATION_DOWNLOAD_FILE_PREFIX}${log.id}${posix.extname(log.storagePath)}`,
      size: object.size,
    };
  }

  async purgeExpired(): Promise<TransformationPurgeResult> {
    const result: TransformationPurgeResult = {
      purgedFilesCount: 0,
      freedSpaceBytes: 0,
      failedCount: 0,
    };
    let lastId: string | undefined;

    for (;;) {
      const qb = this.logRepository
        .createQueryBuilder('log')
        .select(['log.id', 'log.storagePath'])
        .where('"log"."is_stored" = true')
        .andWhere('"log"."expires_at" <= now()')
        .orderBy('log.id', 'ASC')
        .limit(TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE);

      if (lastId) {
        qb.andWhere('"log"."id" > :lastId', { lastId });
      }

      const batch = await qb.getMany();

      if (batch.length === 0) break;

      lastId = batch.at(-1)!.id;

      const purgedIds: string[] = [];

      for (const log of batch) {
        try {
          if (log.storagePath) {
            const object = await this.storage.stat(log.storagePath);

            await this.storage.delete(log.storagePath);
            result.freedSpaceBytes += object?.size ?? 0;
          }

          purgedIds.push(log.id);
        } catch {
          result.failedCount += 1;
          this.logger.warn(
            `Failed to purge transformation output: transformationId=${log.id}`,
          );
        }
      }

      if (purgedIds.length > 0) {
        await this.logRepository.update(
          { id: In(purgedIds), isStored: true },
          { isStored: false, storagePath: null },
        );
        result.purgedFilesCount += purgedIds.length;
      }

      if (batch.length < TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE) break;
    }

    return result;
  }

  private buildKey({
    id,
    userId,
    targetFormat,
    extension,
    createdAt,
  }: TransformationOutputInput): string {
    return posix.join(
      createdAt.toISOString().slice(0, 10),
      userId,
      `${id}_${targetFormat}${extension}`,
    );
  }

  private getConfig(): TransformationStorageConfig {
    return this.configService.getOrThrow<TransformationStorageConfig>(
      'transformationStorage',
    );
  }
}
