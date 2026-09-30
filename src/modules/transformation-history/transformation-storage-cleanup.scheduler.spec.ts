import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TRANSFORMATION_STORAGE_CLEANUP_JOB } from './transformation-history.constants';
import { TransformationFileService } from './transformation-file.service';
import { TransformationStorageCleanupScheduler } from './transformation-storage-cleanup.scheduler';

describe('TransformationStorageCleanupScheduler', () => {
  let registry: SchedulerRegistry;
  let fileService: { purgeExpired: jest.Mock };
  let scheduler: TransformationStorageCleanupScheduler;
  let log: jest.SpyInstance;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    registry = new SchedulerRegistry();
    fileService = { purgeExpired: jest.fn() };
    scheduler = new TransformationStorageCleanupScheduler(
      registry,
      fileService as unknown as TransformationFileService,
      {
        getOrThrow: jest.fn(() => ({ cleanupCron: '0 0 * * *' })),
      } as unknown as ConfigService,
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const job of registry.getCronJobs().values()) void job.stop();
    jest.restoreAllMocks();
  });

  it('registers a started cron job on CLEANUP_CRON_SCHEDULE in UTC', () => {
    scheduler.onApplicationBootstrap();

    const job: CronJob = registry.getCronJob(
      TRANSFORMATION_STORAGE_CLEANUP_JOB,
    );

    expect(job.cronTime.source).toBe('0 0 * * *');
    expect(job.cronTime.timeZone).toBe('UTC');
    expect(job.isActive).toBe(true);
    expect(job.nextDate().toUTC().toISO()).toMatch(/T00:00:00\.000Z$/);
  });

  it('the job tick runs the purge', async () => {
    fileService.purgeExpired.mockResolvedValue({
      purgedFilesCount: 0,
      freedSpaceBytes: 0,
      failedCount: 0,
    });
    const run = jest.spyOn(scheduler, 'run');

    scheduler.onApplicationBootstrap();
    await registry.getCronJob(TRANSFORMATION_STORAGE_CLEANUP_JOB).fireOnTick();

    expect(run).toHaveBeenCalledTimes(1);
    expect(fileService.purgeExpired).toHaveBeenCalledTimes(1);
  });

  it('run() logs purgedFilesCount, freedSpaceBytes and failedCount', async () => {
    fileService.purgeExpired.mockResolvedValue({
      purgedFilesCount: 3,
      freedSpaceBytes: 1024,
      failedCount: 1,
    });

    await scheduler.run();

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /purgedFilesCount=3 freedSpaceBytes=1024 failedCount=1 durationMs=\d+/,
      ),
    );
  });

  it('run() logs and swallows a purge failure', async () => {
    fileService.purgeExpired.mockRejectedValue(new Error('db down'));

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(
      expect.stringMatching(
        /Transformation storage purge failed: durationMs=\d+/,
      ),
    );
  });
});
