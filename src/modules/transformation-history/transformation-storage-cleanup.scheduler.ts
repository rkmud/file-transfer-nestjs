import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TransformationStorageConfig } from '@/core/config/configuration';
import { TRANSFORMATION_STORAGE_CLEANUP_JOB } from './transformation-history.constants';
import { TransformationFileService } from './transformation-file.service';

@Injectable()
export class TransformationStorageCleanupScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(
    TransformationStorageCleanupScheduler.name,
  );

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private fileService: TransformationFileService,
    private configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const { cleanupCron } =
      this.configService.getOrThrow<TransformationStorageConfig>(
        'transformationStorage',
      );

    this.schedulerRegistry.addCronJob(
      TRANSFORMATION_STORAGE_CLEANUP_JOB,
      CronJob.from({
        cronTime: cleanupCron,
        onTick: () => this.run(),
        timeZone: 'UTC',
        waitForCompletion: true,
        start: true,
      }),
    );
  }

  async run(): Promise<void> {
    const startedAt = Date.now();

    try {
      const { purgedFilesCount, freedSpaceBytes, failedCount } =
        await this.fileService.purgeExpired();

      this.logger.log(
        `Transformation storage purge completed: purgedFilesCount=${purgedFilesCount} freedSpaceBytes=${freedSpaceBytes} failedCount=${failedCount} durationMs=${Date.now() - startedAt}`,
      );
    } catch {
      this.logger.error(
        `Transformation storage purge failed: durationMs=${Date.now() - startedAt}`,
      );
    }
  }
}
