import {
  ForbiddenException,
  GoneException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { FakeClock, useFakeClock } from '../../../test/setup/clock';
import { InMemoryDatabase } from '../../../test/setup/in-memory-database';
import { InMemoryRepository } from '../../../test/setup/in-memory-repository';
import { transformationHistoryQueryResolver } from '../../../test/setup/transformation-history-query-resolver';
import { TransformationLog } from './entities/transformation-log.entity';
import { StorageService } from './storage/storage.service';
import { TransformationFileService } from './transformation-file.service';
import { TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE } from './transformation-history.constants';
import { TransformationOutputInput } from './transformation-history.types';

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const DAY = 24 * 60 * 60 * 1000;
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('TransformationFileService', () => {
  let clock: FakeClock;
  let repo: InMemoryRepository<TransformationLog>;
  let storage: jest.Mocked<StorageService>;
  let service: TransformationFileService;
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  const seedLog = (overrides: Partial<TransformationLog> = {}) =>
    repo.seed({
      id: id(1),
      userId: USER_A,
      type: 'file',
      sourceFormat: 'csv',
      targetFormat: 'json',
      status: 'success',
      errorCode: null,
      fileSize: 10,
      durationMs: 1,
      sourceFilePath: null,
      targetFilePath: null,
      createdAt: new Date('2026-01-15T10:00:00.000Z'),
      ...overrides,
    })[0];

  const output = (
    overrides: Partial<TransformationOutputInput> = {},
  ): TransformationOutputInput => ({
    id: id(1),
    userId: USER_A,
    targetFormat: 'json',
    extension: '.json',
    createdAt: new Date('2026-01-15T23:30:00.000-05:00'),
    open: () => Readable.from(['{}']),
    ...overrides,
  });

  beforeEach(() => {
    clock = useFakeClock('2026-01-20T00:00:00.000Z');
    repo = new InMemoryDatabase().repo(TransformationLog);
    repo.setQueryResolver(transformationHistoryQueryResolver);
    storage = {
      put: jest.fn().mockResolvedValue({ size: 2 }),
      stat: jest.fn().mockResolvedValue({ size: 2 }),
      openRead: jest.fn<Readable, [string]>(() => Readable.from(['{}'])),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      getOrThrow: jest.fn(() => ({ retentionDays: 90 })),
    } as unknown as ConfigService;

    service = new TransformationFileService(repo as never, storage, config);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    logWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    clock.restore();
    jest.restoreAllMocks();
  });

  describe('persist()', () => {
    it('stores under {YYYY-MM-DD UTC}/{userId}/{itemId}_{target}{ext} and marks the row stored', async () => {
      const input = output();

      seedLog({ createdAt: input.createdAt, storageErrorCode: 'STORAGE_FULL' });
      await service.persist(input);

      // 23:30 at UTC-5 is already the next day in UTC.
      const key = `2026-01-16/${USER_A}/${id(1)}_json.json`;

      expect(storage.put).toHaveBeenCalledWith(key, expect.any(Readable));
      expect(repo.all()[0]).toMatchObject({
        isStored: true,
        storagePath: key,
        expiresAt: new Date(input.createdAt.getTime() + 90 * DAY),
        storageErrorCode: null,
      });
    });

    it('discards the stored file when the history row is missing', async () => {
      await service.persist(output());

      expect(storage.delete).toHaveBeenCalledWith(
        `2026-01-16/${USER_A}/${id(1)}_json.json`,
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('history record missing'),
      );
    });

    it.each([
      ['ENOSPC', 'STORAGE_FULL'],
      ['EACCES', 'STORAGE_WRITE_FAILED'],
      [undefined, 'STORAGE_WRITE_FAILED'],
    ])(
      'on a %s failure records %s and leaves expires_at unset',
      async (code, storageErrorCode) => {
        seedLog();
        storage.put.mockRejectedValueOnce(
          code ? errno(code) : new Error('boom'),
        );

        await expect(service.persist(output())).resolves.toBeUndefined();
        expect(repo.all()[0]).toMatchObject({
          isStored: false,
          storagePath: null,
          expiresAt: null,
          storageErrorCode,
        });
      },
    );

    it('swallows a failure to record the storage error', async () => {
      seedLog();
      storage.put.mockRejectedValueOnce(errno('EIO'));
      jest.spyOn(repo, 'update').mockRejectedValueOnce(new Error('db'));

      await expect(service.persist(output())).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record storage error'),
      );
    });
  });

  describe('download()', () => {
    const stored = (overrides: Partial<TransformationLog> = {}) =>
      seedLog({
        isStored: true,
        storagePath: `2026-01-15/${USER_A}/${id(1)}_json.json`,
        expiresAt: new Date('2026-04-15T10:00:00.000Z'),
        ...overrides,
      });

    it('returns the stream, MIME type, file name and size for the owner', async () => {
      stored();
      storage.stat.mockResolvedValueOnce({ size: 7 });

      const result = await service.download(USER_A, id(1), { kind: 'self' });

      expect(result).toEqual({
        stream: expect.any(Readable),
        mimeType: 'application/json; charset=utf-8',
        fileName: `transformed_${id(1)}.json`,
        size: 7,
      });
      expect(storage.openRead).toHaveBeenCalledWith(
        `2026-01-15/${USER_A}/${id(1)}_json.json`,
      );
    });

    it('falls back to application/octet-stream for an unknown target format', async () => {
      stored({ targetFormat: 'bin', storagePath: `x/${id(1)}_bin.bin` });

      const result = await service.download(USER_A, id(1), { kind: 'self' });

      expect(result.mimeType).toBe('application/octet-stream');
      expect(result.fileName).toBe(`transformed_${id(1)}.bin`);
    });

    it('404 when the item does not exist', async () => {
      await expect(
        service.download(USER_A, id(9), { kind: 'self' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("403 for another user's item", async () => {
      stored();

      await expect(
        service.download(USER_B, id(1), { kind: 'self' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 without expires_at (never saved / save failed)', async () => {
      seedLog({ storageErrorCode: 'STORAGE_FULL' });

      await expect(
        service.download(USER_A, id(1), { kind: 'self' }),
      ).rejects.toThrow('No saved file for this transformation');
    });

    it('410 when expires_at has passed', async () => {
      stored({ expiresAt: new Date('2026-01-19T23:59:59.999Z') });

      await expect(
        service.download(USER_A, id(1), { kind: 'self' }),
      ).rejects.toBeInstanceOf(GoneException);
      expect(storage.stat).not.toHaveBeenCalled();
    });

    it('410 exactly at expires_at', async () => {
      stored({ expiresAt: clock.now() });

      await expect(
        service.download(USER_A, id(1), { kind: 'self' }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('410 when purged (expires_at kept, not stored)', async () => {
      stored({ isStored: false, storagePath: null });

      await expect(
        service.download(USER_A, id(1), { kind: 'self' }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('410 when the file is missing on disk', async () => {
      stored();
      storage.stat.mockResolvedValueOnce(null);

      await expect(
        service.download(USER_A, id(1), { kind: 'self' }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('admin scope without userId can download any item', async () => {
      stored();

      await expect(
        service.download(USER_B, id(1), { kind: 'admin' }),
      ).resolves.toMatchObject({ size: 2 });
    });

    it('admin scope with the owning userId succeeds', async () => {
      stored();

      await expect(
        service.download(USER_B, id(1), { kind: 'admin', userId: USER_A }),
      ).resolves.toMatchObject({ size: 2 });
    });

    it('admin scope with a different userId is 404', async () => {
      stored();

      await expect(
        service.download(USER_A, id(1), { kind: 'admin', userId: USER_B }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('purgeExpired()', () => {
    const seedStored = (n: number, expiresAt: Date, path?: string | null) =>
      seedLog({
        id: id(n),
        isStored: true,
        storagePath: path === undefined ? `p/${n}` : path,
        expiresAt,
      });

    it('purges only is_stored rows expired at now(), keeping expires_at', async () => {
      const past = new Date('2026-01-19T00:00:00.000Z');
      const future = new Date('2026-01-21T00:00:00.000Z');

      seedStored(1, past);
      seedStored(2, clock.now());
      seedStored(3, future);
      seedLog({ id: id(4), expiresAt: past }); // already purged
      storage.stat
        .mockResolvedValueOnce({ size: 5 })
        .mockResolvedValueOnce(null);

      const result = await service.purgeExpired();

      expect(result).toEqual({
        purgedFilesCount: 2,
        freedSpaceBytes: 5,
        failedCount: 0,
      });
      expect(storage.delete.mock.calls).toEqual([['p/1'], ['p/2']]);
      const byId = new Map(repo.all().map((r) => [r.id, r]));

      expect(byId.get(id(1))).toMatchObject({
        isStored: false,
        storagePath: null,
        expiresAt: past,
      });
      expect(byId.get(id(3))).toMatchObject({ isStored: true });
    });

    it('clears rows without a storage path without touching storage', async () => {
      seedStored(1, new Date('2026-01-01T00:00:00.000Z'), null);

      await expect(service.purgeExpired()).resolves.toEqual({
        purgedFilesCount: 1,
        freedSpaceBytes: 0,
        failedCount: 0,
      });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('leaves rows whose delete failed stored for the next run', async () => {
      const past = new Date('2026-01-01T00:00:00.000Z');

      seedStored(1, past);
      seedStored(2, past);
      storage.delete.mockRejectedValueOnce(errno('EBUSY'));

      const result = await service.purgeExpired();

      expect(result).toEqual({
        purgedFilesCount: 1,
        freedSpaceBytes: 2,
        failedCount: 1,
      });
      expect(repo.all().find((r) => r.id === id(1))).toMatchObject({
        isStored: true,
        storagePath: 'p/1',
      });
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining(`transformationId=${id(1)}`),
      );

      // Next run retries it.
      await expect(service.purgeExpired()).resolves.toMatchObject({
        purgedFilesCount: 1,
      });
      expect(repo.all().every((r) => !r.isStored)).toBe(true);
    });

    it('does nothing when nothing is expired', async () => {
      await expect(service.purgeExpired()).resolves.toEqual({
        purgedFilesCount: 0,
        freedSpaceBytes: 0,
        failedCount: 0,
      });
      expect(repo.queries).toHaveLength(1);
      expect(repo.queries[0].wheres).toEqual([
        '"log"."is_stored" = true',
        '"log"."expires_at" <= now()',
      ]);
    });

    it('walks in keyset batches of the configured size', async () => {
      const past = new Date('2026-01-01T00:00:00.000Z');
      const total = TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE * 2;

      for (let n = 1; n <= total; n += 1) seedStored(n, past);

      const result = await service.purgeExpired();

      expect(result.purgedFilesCount).toBe(total);
      // two full batches + one empty batch that ends the loop
      expect(repo.queries).toHaveLength(3);
      expect(repo.queries[0].limit).toBe(
        TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE,
      );
      expect(repo.queries[0].params.lastId).toBeUndefined();
      expect(repo.queries[1].params.lastId).toBe(
        id(TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE),
      );
      expect(repo.queries[1].wheres).toContain('"log"."id" > :lastId');
      expect(repo.queries[1].calls).toContainEqual({
        method: 'orderBy',
        args: ['log.id', 'ASC'],
      });
    });

    it('stops after a partial batch', async () => {
      const past = new Date('2026-01-01T00:00:00.000Z');

      for (
        let n = 1;
        n <= TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE + 1;
        n += 1
      ) {
        seedStored(n, past);
      }

      await expect(service.purgeExpired()).resolves.toMatchObject({
        purgedFilesCount: TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE + 1,
      });
      expect(repo.queries).toHaveLength(2);
    });

    it('skips the row update when a whole batch failed', async () => {
      seedStored(1, new Date('2026-01-01T00:00:00.000Z'));
      storage.stat.mockRejectedValueOnce(errno('EIO'));
      const update = jest.spyOn(repo, 'update');

      await expect(service.purgeExpired()).resolves.toEqual({
        purgedFilesCount: 0,
        freedSpaceBytes: 0,
        failedCount: 1,
      });
      expect(update).not.toHaveBeenCalled();
    });
  });
});
