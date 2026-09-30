/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { ImageConversionConfig } from '@/core/config/configuration';
import { TransformationFileService } from '@/modules/transformation-history/transformation-file.service';
import { TransformationHistoryService } from '@/modules/transformation-history/transformation-history.service';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from '../entities/conversion.entity';
import { createImageFormatRegistry } from '../images/image-format-registry';
import { ImageConversionRequest } from '../conversion.types';
import { ConversionStorage } from './conversion-storage.service';
import { SharpImageConversionService } from './image-conversion.service';
import { ImageWorkerPool } from './image-worker-pool.service';
import { ConversionTimeoutError } from './worker-pool';
import { InMemoryDatabase } from '../../../../test/setup/in-memory-database';
import { InMemoryRepository } from '../../../../test/setup/in-memory-repository';

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const SVG_HEAD = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

const baseConfig = (): ImageConversionConfig => ({
  maxSizes: { png: 1000, jpeg: 1000, svg: 500 },
  maxRasterWidth: 100,
  maxRasterHeight: 80,
  maxInputPixels: 5000,
  timeoutMs: 1500,
  workerThreads: 1,
  workerMaxHeapMb: 64,
});

const file = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    originalname: 'photo.png',
    mimetype: 'image/png',
    size: 100,
    path: '/storage/incoming/upload-1',
    ...overrides,
  }) as Express.Multer.File;

describe('SharpImageConversionService', () => {
  let db: InMemoryDatabase;
  let repo: InMemoryRepository<Conversion>;
  let config: ImageConversionConfig;
  let storage: jest.Mocked<ConversionStorage>;
  let workerPool: { run: jest.Mock };
  let history: { record: jest.Mock };
  let fileService: { persist: jest.Mock };
  let service: SharpImageConversionService;
  let head: Buffer;
  const stream = Readable.from([]) as any;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    db = new InMemoryDatabase();
    repo = db.repo(Conversion);
    config = baseConfig();
    head = PNG_HEAD;
    storage = {
      readHead: jest.fn(() => Promise.resolve(head)),
      storeInput: jest.fn(
        (_path: string, userId: string, id: string, ext: string) =>
          Promise.resolve(`/storage/inputs/${userId}/${id}${ext}`),
      ),
      prepareOutput: jest.fn((userId: string, id: string, ext: string) =>
        Promise.resolve({
          tempPath: `/storage/outputs/${userId}/${id}${ext}.part`,
          finalPath: `/storage/outputs/${userId}/${id}${ext}`,
        }),
      ),
      commitOutput: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      removeLingering: jest.fn().mockResolvedValue(undefined),
      openRead: jest.fn().mockReturnValue(stream),
      toRelative: jest.fn((path: string) => path.replace('/storage/', '')),
    } as unknown as jest.Mocked<ConversionStorage>;
    workerPool = {
      run: jest.fn().mockResolvedValue({
        ok: true,
        outputSize: 42,
        width: 8,
        height: 8,
      }),
    };
    history = { record: jest.fn().mockResolvedValue(undefined) };
    fileService = { persist: jest.fn().mockResolvedValue(undefined) };
    service = new SharpImageConversionService(
      repo as unknown as Repository<Conversion>,
      createImageFormatRegistry(),
      storage,
      workerPool as unknown as ImageWorkerPool,
      {
        getOrThrow: jest.fn((key: string) => {
          expect(key).toBe('imageConversion');
          return config;
        }),
      } as unknown as ConfigService,
      history as unknown as TransformationHistoryService,
      fileService as unknown as TransformationFileService,
    );
  });

  const request = (
    overrides: Partial<ImageConversionRequest> = {},
  ): ImageConversionRequest => ({
    userId: 'user-1',
    file: file(),
    targetFormat: 'jpeg',
    ...overrides,
  });

  const failure = async (
    promise: Promise<unknown>,
  ): Promise<{ status: number; body: any }> => {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(HttpException);

    return {
      status: (error as HttpException).getStatus(),
      body: (error as HttpException).getResponse(),
    };
  };

  const onlyRecord = (): Conversion => {
    const rows = repo.all();

    expect(rows).toHaveLength(1);

    return rows[0];
  };

  it('lists the supported directions', () => {
    expect(service.getSupportedFormats()).toEqual([
      { source: 'png', target: ['jpeg'] },
      { source: 'jpeg', target: ['png'] },
      { source: 'svg', target: ['png', 'jpeg'] },
    ]);
  });

  describe('missing input', () => {
    it('rejects a missing file with 400 and records nothing', async () => {
      const { status } = await failure(
        service.convert(request({ file: undefined })),
      );

      expect(status).toBe(400);
      expect(storage.remove).toHaveBeenCalledWith(undefined);
      expect(repo.all()).toHaveLength(0);
    });

    it('rejects an empty file and removes the upload', async () => {
      const { status } = await failure(
        service.convert(request({ file: file({ size: 0 }) })),
      );

      expect(status).toBe(400);
      expect(storage.remove).toHaveBeenCalledWith('/storage/incoming/upload-1');
    });
  });

  describe('success', () => {
    it('converts PNG -> JPEG and records a successful image conversion', async () => {
      const result = await service.convert(request());
      const record = onlyRecord();

      expect(result).toEqual({
        stream,
        mimeType: 'image/jpeg',
        fileName: 'converted.jpg',
        size: 42,
      });
      expect(workerPool.run).toHaveBeenCalledWith({
        inputPath: `/storage/inputs/user-1/${record.id}.png`,
        outputPath: `/storage/outputs/user-1/${record.id}.jpg.part`,
        sourceFormat: 'png',
        targetFormat: 'jpeg',
        options: {
          quality: 85,
          width: undefined,
          height: undefined,
          background: '#ffffff',
        },
        limits: {
          maxInputPixels: 5000,
          maxRasterWidth: 100,
          maxRasterHeight: 80,
        },
      });
      expect(storage.commitOutput).toHaveBeenCalled();
      expect(storage.openRead).toHaveBeenCalledWith(
        `/storage/outputs/user-1/${record.id}.jpg`,
      );
      expect(record).toMatchObject({
        userId: 'user-1',
        type: ConversionType.Image,
        status: ConversionStatus.Success,
        inputFileName: 'photo.png',
        inputFormat: 'png',
        inputSize: 100,
        inputPath: `inputs/user-1/${record.id}.png`,
        outputFormat: 'jpeg',
        outputFileName: 'converted.jpg',
        outputPath: `outputs/user-1/${record.id}.jpg`,
        outputSize: 42,
        errorCode: null,
        errorReason: null,
      });
      expect(record.completedAt).toBeInstanceOf(Date);
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({
          id: record.id,
          type: ConversionType.Image,
          status: 'success',
          errorCode: null,
        }),
      );
      expect(fileService.persist).not.toHaveBeenCalled();
    });

    it('sanitizes the stored input file name', async () => {
      await service.convert(
        request({ file: file({ originalname: '../../etc/evil.png' }) }),
      );

      expect(onlyRecord().inputFileName).toBe('evil.png');
    });

    it('passes quality through and ignores background for raster sources', async () => {
      head = JPEG_HEAD;
      await service.convert(
        request({
          file: file({ originalname: 'a.jpg', mimetype: 'image/jpeg' }),
          targetFormat: 'png',
          quality: 10,
          width: 5000,
          background: '#000000',
        }),
      );

      expect(workerPool.run).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceFormat: 'jpeg',
          targetFormat: 'png',
          options: {
            quality: 10,
            width: 5000,
            height: undefined,
            background: '#ffffff',
          },
        }),
      );
    });

    it('uses the requested background (or the default) for SVG sources', async () => {
      head = SVG_HEAD;
      const svgFile = () =>
        file({ originalname: 'a.svg', mimetype: 'image/svg+xml' });

      await service.convert(
        request({
          file: svgFile(),
          targetFormat: 'png',
          width: 100,
          height: 80,
          background: '#123456',
        }),
      );
      await service.convert(request({ file: svgFile(), targetFormat: 'png' }));

      expect(workerPool.run.mock.calls[0][0].options).toMatchObject({
        width: 100,
        height: 80,
        background: '#123456',
      });
      expect(workerPool.run.mock.calls[1][0].options.background).toBe(
        '#ffffff',
      );
    });

    it('fires a background save when save=true, without awaiting it', async () => {
      let resolvePersist!: () => void;

      fileService.persist.mockReturnValueOnce(
        new Promise<void>((resolve) => (resolvePersist = resolve)),
      );

      const result = await service.convert(request({ save: true }));
      const record = onlyRecord();

      expect(result.size).toBe(42);
      expect(fileService.persist).toHaveBeenCalledWith({
        id: record.id,
        userId: 'user-1',
        targetFormat: 'jpeg',
        extension: '.jpg',
        createdAt: record.createdAt,
        open: expect.any(Function),
      });

      storage.openRead.mockClear();
      fileService.persist.mock.calls[0][0].open();
      expect(storage.openRead).toHaveBeenCalledWith(
        `/storage/outputs/user-1/${record.id}.jpg`,
      );
      resolvePersist();
    });

    it('still succeeds when saving the conversion row fails', async () => {
      const save = repo.save.bind(repo);
      let calls = 0;

      jest.spyOn(repo, 'save').mockImplementation((input: any) => {
        calls += 1;
        return calls === 2 ? Promise.reject(new Error('db down')) : save(input);
      });

      await expect(service.convert(request())).resolves.toMatchObject({
        size: 42,
      });
      expect(history.record).toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it.each([
      ['UNSUPPORTED_FORMAT', 415, { originalname: 'photo.gif' }],
      ['UNSUPPORTED_FORMAT', 415, { mimetype: 'image/jpeg' }],
    ])(
      'maps detection errors to %s / %d',
      async (code, status, overrides: Partial<Express.Multer.File>) => {
        const result = await failure(
          service.convert(request({ file: file(overrides) })),
        );
        const record = onlyRecord();

        expect(result).toMatchObject({
          status,
          body: { code, statusCode: status },
        });
        expect(record).toMatchObject({
          status: ConversionStatus.Error,
          errorCode: status,
          errorReason: code,
          inputFormat: null,
          inputPath: null,
        });
        expect(storage.remove).toHaveBeenCalledWith(
          '/storage/incoming/upload-1',
        );
        expect(storage.storeInput).not.toHaveBeenCalled();
        expect(history.record).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'error', errorCode: code }),
        );
      },
    );

    it('rejects a file above its format limit with 413 FILE_TOO_LARGE', async () => {
      const result = await failure(
        service.convert(request({ file: file({ size: 1001 }) })),
      );

      expect(result).toMatchObject({
        status: 413,
        body: {
          code: 'FILE_TOO_LARGE',
          message: 'PNG files are limited to 1000 bytes',
        },
      });
      expect(onlyRecord()).toMatchObject({
        inputFormat: 'png',
        errorCode: 413,
        errorReason: 'FILE_TOO_LARGE',
      });
    });

    it('treats a format without a configured limit as unlimited', async () => {
      config.maxSizes = {};

      await expect(
        service.convert(request({ file: file({ size: 10_000_000 }) })),
      ).resolves.toBeDefined();
    });

    it('rejects vectorization with 400 VECTORIZATION_NOT_SUPPORTED', async () => {
      const result = await failure(
        service.convert(request({ targetFormat: 'svg' })),
      );

      expect(result).toMatchObject({
        status: 400,
        body: { code: 'VECTORIZATION_NOT_SUPPORTED' },
      });
      expect(workerPool.run).not.toHaveBeenCalled();
    });

    it('rejects a same-format target with 400 UNSUPPORTED_DIRECTION', async () => {
      const result = await failure(
        service.convert(request({ targetFormat: 'png' })),
      );

      expect(result).toMatchObject({
        status: 400,
        body: { code: 'UNSUPPORTED_DIRECTION' },
      });
    });

    it.each([[{ width: 101 }], [{ height: 81 }]])(
      'rejects requested SVG dimensions above the caps (%j) before running the worker',
      async (size) => {
        head = SVG_HEAD;

        const result = await failure(
          service.convert(
            request({
              file: file({ originalname: 'a.svg', mimetype: 'image/svg+xml' }),
              targetFormat: 'png',
              ...size,
            }),
          ),
        );

        expect(result).toMatchObject({
          status: 400,
          body: {
            code: 'EXCEEDED_MAX_DIMENSIONS',
            message: 'Requested size exceeds the 100x80 px limit',
          },
        });
        expect(workerPool.run).not.toHaveBeenCalled();
        expect(onlyRecord().inputFormat).toBe('svg');
      },
    );

    it.each([
      ['INVALID_IMAGE', 400],
      ['SVG_SANITY_FAILED', 400],
      ['EXCEEDED_MAX_DIMENSIONS', 400],
      ['EXCEEDED_MAX_PIXELS', 400],
      ['UNSUPPORTED_DIRECTION', 400],
    ])('maps a worker %s result to HTTP %d', async (code, status) => {
      workerPool.run.mockResolvedValueOnce({ ok: false, code, message: 'm' });

      const result = await failure(service.convert(request()));
      const record = onlyRecord();

      expect(result).toEqual({
        status,
        body: { statusCode: status, code, message: 'm' },
      });
      expect(record).toMatchObject({ errorCode: status, errorReason: code });
      expect(record.inputPath).toBe(`inputs/user-1/${record.id}.png`);
      expect(storage.remove).toHaveBeenCalledWith(
        `/storage/outputs/user-1/${record.id}.jpg.part`,
      );
      // the input was already moved into storage: the upload is not removed
      expect(storage.remove).not.toHaveBeenCalledWith(
        '/storage/incoming/upload-1',
      );
      expect(storage.commitOutput).not.toHaveBeenCalled();
    });

    it('maps a worker INTERNAL result to a generic 500', async () => {
      workerPool.run.mockResolvedValueOnce({
        ok: false,
        code: 'INTERNAL',
        message: 'EACCES /secret',
      });

      const result = await failure(service.convert(request()));

      expect(result.status).toBe(500);
      expect(JSON.stringify(result.body)).not.toContain('secret');
      expect(onlyRecord()).toMatchObject({
        errorCode: 500,
        errorReason: 'INTERNAL',
      });
    });

    it('maps a timeout to 408 TIMEOUT and schedules lingering cleanup', async () => {
      workerPool.run.mockRejectedValueOnce(new ConversionTimeoutError());

      const result = await failure(service.convert(request()));
      const record = onlyRecord();

      expect(result).toMatchObject({
        status: 408,
        body: 'Conversion exceeded the 1500 ms time limit',
      });
      expect(record).toMatchObject({ errorCode: 408, errorReason: 'TIMEOUT' });
      expect(storage.removeLingering).toHaveBeenCalledWith(
        `/storage/outputs/user-1/${record.id}.jpg.part`,
      );
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'TIMEOUT' }),
      );
    });

    it('maps an unexpected error before storage to 500 and removes the upload', async () => {
      storage.storeInput.mockRejectedValueOnce(new Error('disk full'));

      const result = await failure(service.convert(request()));

      expect(result.status).toBe(500);
      expect(storage.remove).toHaveBeenCalledWith(undefined);
      expect(storage.remove).toHaveBeenCalledWith('/storage/incoming/upload-1');
      expect(storage.removeLingering).not.toHaveBeenCalled();
      expect(onlyRecord()).toMatchObject({
        errorCode: 500,
        errorReason: 'INTERNAL',
      });
    });
  });
});
