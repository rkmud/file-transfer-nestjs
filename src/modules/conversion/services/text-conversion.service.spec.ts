import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { InMemoryDatabase } from '../../../../test/setup/in-memory-database';
import { TransformationFileService } from '@/modules/transformation-history/transformation-file.service';
import { TransformationHistoryService } from '@/modules/transformation-history/transformation-history.service';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from '../entities/conversion.entity';
import { createFormatRegistry } from '../formats/format-registry';
import { ConversionStorage } from './conversion-storage.service';
import {
  ConversionTimeoutError,
  ConversionWorkerPool,
} from './conversion-worker-pool.service';
import { TextConversionService } from './text-conversion.service';

const CONFIG = {
  storageDir: '/storage',
  maxSizes: { csv: 100, json: 100, xml: 100 } as Record<string, number>,
  streamThresholdBytes: 50,
  timeoutMs: 3000,
  maxDepth: 10,
  maxNodes: 1000,
  maxYamlAliases: 5,
  workerThreads: 1,
  workerMaxHeapMb: 64,
};

const CSV = 'a,b\n1,2\n';

const makeFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    originalname: 'data.csv',
    path: '/storage/incoming/upload-1',
    size: Buffer.byteLength(CSV),
    ...overrides,
  }) as Express.Multer.File;

describe('TextConversionService', () => {
  let db: InMemoryDatabase;
  let repo: ReturnType<InMemoryDatabase['repo']>;
  let storage: jest.Mocked<ConversionStorage>;
  let pool: { run: jest.Mock };
  let history: { record: jest.Mock };
  let files: { persist: jest.Mock };
  let head: Buffer;
  let service: TextConversionService;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    db = new InMemoryDatabase();
    repo = db.repo(Conversion);
    head = Buffer.from(CSV);
    storage = {
      readHead: jest.fn(async () => head),
      storeInput: jest.fn(
        async (_path: string, userId: string, id: string, ext: string) =>
          `/storage/inputs/${userId}/${id}${ext}`,
      ),
      prepareOutput: jest.fn(
        async (userId: string, id: string, ext: string) => ({
          finalPath: `/storage/outputs/${userId}/${id}${ext}`,
          tempPath: `/storage/outputs/${userId}/${id}${ext}.part`,
        }),
      ),
      commitOutput: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      removeLingering: jest.fn().mockResolvedValue(undefined),
      openRead: jest.fn(() => Readable.from(['out']) as never),
      toRelative: jest.fn((path: string) => path.replace('/storage/', '')),
    } as unknown as jest.Mocked<ConversionStorage>;
    pool = { run: jest.fn().mockResolvedValue({ ok: true, outputSize: 17 }) };
    history = { record: jest.fn().mockResolvedValue(undefined) };
    files = { persist: jest.fn().mockResolvedValue(undefined) };
    service = new TextConversionService(
      repo as unknown as Repository<Conversion>,
      createFormatRegistry(),
      storage,
      pool as unknown as ConversionWorkerPool,
      {
        getOrThrow: jest.fn().mockReturnValue(CONFIG),
      } as unknown as ConfigService,
      history as unknown as TransformationHistoryService,
      files as unknown as TransformationFileService,
    );
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const rows = (): Conversion[] => repo.all() as Conversion[];

  const convertError = async (
    request: Partial<Parameters<TextConversionService['convert']>[0]> = {},
  ): Promise<HttpException> =>
    service
      .convert({
        userId: 'user-1',
        file: makeFile(),
        targetFormat: 'json',
        ...request,
      })
      .then(
        () => {
          throw new Error('expected convert to fail');
        },
        (e: HttpException) => e,
      );

  it('lists every direction except identity', () => {
    expect(service.getSupportedFormats()).toEqual([
      { source: 'csv', target: ['json', 'xml', 'yaml'] },
      { source: 'json', target: ['csv', 'xml', 'yaml'] },
      { source: 'xml', target: ['csv', 'json', 'yaml'] },
      { source: 'yaml', target: ['csv', 'json', 'xml'] },
    ]);
  });

  describe('request validation (no conversion row)', () => {
    it('rejects a missing file with 400', async () => {
      const exception = await convertError({ file: undefined });

      expect(exception).toBeInstanceOf(BadRequestException);
      expect(storage.remove).toHaveBeenCalledWith(undefined);
      expect(rows()).toHaveLength(0);
    });

    it('rejects an empty file with 400 and removes the upload', async () => {
      const exception = await convertError({ file: makeFile({ size: 0 }) });

      expect(exception.getStatus()).toBe(400);
      expect(storage.remove).toHaveBeenCalledWith('/storage/incoming/upload-1');
      expect(rows()).toHaveLength(0);
    });

    it('rejects an unknown target with 415 and removes the upload', async () => {
      const exception = await convertError({ targetFormat: 'pdf' });

      expect(exception.getStatus()).toBe(415);
      expect(exception.message).toBe('Unsupported target format "pdf"');
      expect(storage.remove).toHaveBeenCalledWith('/storage/incoming/upload-1');
      expect(rows()).toHaveLength(0);
      expect(history.record).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('runs the worker, commits the output and records history', async () => {
      const result = await service.convert({
        userId: 'user-1',
        file: makeFile({ originalname: '../evil/data.csv' }),
        targetFormat: '  JSON ',
      });

      const [row] = rows();

      expect(pool.run).toHaveBeenCalledWith({
        inputPath: `/storage/inputs/user-1/${row.id}.csv`,
        inputSize: Buffer.byteLength(CSV),
        outputPath: `/storage/outputs/user-1/${row.id}.json.part`,
        sourceFormat: 'csv',
        targetFormat: 'json',
        limits: { maxDepth: 10, maxNodes: 1000, maxYamlAliases: 5 },
        streamThresholdBytes: 50,
      });
      expect(storage.commitOutput).toHaveBeenCalledWith({
        finalPath: `/storage/outputs/user-1/${row.id}.json`,
        tempPath: `/storage/outputs/user-1/${row.id}.json.part`,
      });
      expect(result).toMatchObject({
        mimeType: 'application/json; charset=utf-8',
        fileName: 'converted.json',
        size: 17,
      });
      expect(storage.openRead).toHaveBeenCalledWith(
        `/storage/outputs/user-1/${row.id}.json`,
      );
      expect(row).toMatchObject({
        userId: 'user-1',
        type: ConversionType.File,
        inputFileName: 'data.csv',
        inputFormat: 'csv',
        outputFormat: 'json',
        status: ConversionStatus.Success,
        inputPath: `inputs/user-1/${row.id}.csv`,
        outputPath: `outputs/user-1/${row.id}.json`,
        outputFileName: 'converted.json',
        outputSize: 17,
      });
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ id: row.id, status: 'success' }),
      );
      expect(files.persist).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Conversion succeeded: userId=user-1 sourceFormat=csv targetFormat=json fileSize=8 durationMs=\d+ result=success$/,
        ),
      );
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('fires a background save when requested', async () => {
      await service.convert({
        userId: 'user-1',
        file: makeFile(),
        targetFormat: 'yaml',
        save: true,
      });

      const [row] = rows();

      expect(files.persist).toHaveBeenCalledWith({
        id: row.id,
        userId: 'user-1',
        targetFormat: 'yaml',
        extension: '.yaml',
        createdAt: row.createdAt,
        open: expect.any(Function),
      });

      storage.openRead.mockClear();
      files.persist.mock.calls[0][0].open();
      expect(storage.openRead).toHaveBeenCalledWith(
        `/storage/outputs/user-1/${row.id}.yaml`,
      );
    });

    it('allows any size when the source format has no configured limit', async () => {
      head = Buffer.from('- a: 1\n');

      await expect(
        service.convert({
          userId: 'user-1',
          file: makeFile({ originalname: 'x.yaml', size: 10_000 }),
          targetFormat: 'json',
        }),
      ).resolves.toMatchObject({ fileName: 'converted.json' });
    });

    it('logs but does not fail when the final conversion row cannot be saved', async () => {
      const save = jest.spyOn(repo, 'save');

      save.mockImplementationOnce(async (entity) => {
        (entity as Conversion).id = 'conv-x';
        (entity as Conversion).createdAt = new Date();

        return entity;
      });
      save.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.convert({
          userId: 'user-1',
          file: makeFile(),
          targetFormat: 'xml',
        }),
      ).resolves.toMatchObject({ fileName: 'converted.xml' });
      expect(error).toHaveBeenCalledWith(
        'Failed to record conversion history: conversionId=conv-x',
      );
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conv-x' }),
      );
    });
  });

  describe('failures after the row is created', () => {
    const expectErrorRow = (errorCode: number, errorReason: string) => {
      const [row] = rows();

      expect(row).toMatchObject({
        status: ConversionStatus.Error,
        errorCode,
        errorReason,
        type: ConversionType.File,
      });
      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({
          id: row.id,
          status: 'error',
          errorCode: errorReason,
        }),
      );

      return row;
    };

    it('undetectable source → 415 UNSUPPORTED_FORMAT, upload removed', async () => {
      const exception = await convertError({
        file: makeFile({ originalname: 'data.bin' }),
      });

      expect(exception.getStatus()).toBe(415);
      expect(storage.remove).toHaveBeenCalledWith('/storage/incoming/upload-1');
      const row = expectErrorRow(415, 'UNSUPPORTED_FORMAT');

      expect(row.inputFormat).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('sourceFormat=unknown'),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('code=415'));
    });

    it('same source and target → 415 with reason UNSUPPORTED_FORMAT', async () => {
      const exception = await convertError({ targetFormat: 'csv' });

      expect(exception.getStatus()).toBe(415);
      expect(exception.message).toBe(
        'Conversion from csv to csv is not supported',
      );
      expectErrorRow(415, 'UNSUPPORTED_FORMAT');
      expect(pool.run).not.toHaveBeenCalled();
    });

    it('over the per-format limit → 413 FILE_TOO_LARGE', async () => {
      const exception = await convertError({ file: makeFile({ size: 101 }) });

      expect(exception.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(exception.message).toBe('CSV files are limited to 100 bytes');
      expectErrorRow(413, 'FILE_TOO_LARGE');
      expect(storage.storeInput).not.toHaveBeenCalled();
    });

    it.each([
      ['SYNTAX_ERROR', 400],
      ['INVALID_ENCODING', 400],
      ['LIMIT_EXCEEDED', 400],
      ['FORBIDDEN_CONSTRUCT', 400],
      ['UNSUPPORTED_FORMAT', 415],
    ])(
      'worker failure %s → %d with the parser message',
      async (code, status) => {
        pool.run.mockResolvedValueOnce({ ok: false, code, message: 'bad @1' });

        const exception = await convertError();

        expect(exception.getStatus()).toBe(status);
        expect(exception.message).toBe('bad @1');
        const row = expectErrorRow(status, code);

        expect(storage.commitOutput).not.toHaveBeenCalled();
        expect(storage.remove).toHaveBeenCalledWith(
          `/storage/outputs/user-1/${row.id}.json.part`,
        );
        expect(storage.remove).not.toHaveBeenCalledWith(
          '/storage/incoming/upload-1',
        );
        expect(storage.removeLingering).not.toHaveBeenCalled();
      },
    );

    it('worker INTERNAL failure → 500 without the internal message', async () => {
      pool.run.mockResolvedValueOnce({
        ok: false,
        code: 'INTERNAL',
        message: 'TypeError',
      });

      const exception = await convertError();

      expect(exception.getStatus()).toBe(500);
      expect(exception.message).toBe('Conversion failed');
      expectErrorRow(500, 'INTERNAL');
    });

    it('timeout → 408 TIMEOUT and lingering .part cleanup', async () => {
      pool.run.mockRejectedValueOnce(new ConversionTimeoutError());

      const exception = await convertError();

      expect(exception.getStatus()).toBe(408);
      expect(exception.message).toBe(
        'Conversion exceeded the 3000 ms time limit',
      );
      const row = expectErrorRow(408, 'TIMEOUT');

      expect(storage.removeLingering).toHaveBeenCalledWith(
        `/storage/outputs/user-1/${row.id}.json.part`,
      );
    });

    it('unexpected storage error before the input is stored → 500 INTERNAL', async () => {
      storage.storeInput.mockRejectedValueOnce(new Error('EACCES'));

      const exception = await convertError();

      expect(exception.getStatus()).toBe(500);
      expectErrorRow(500, 'INTERNAL');
      expect(storage.remove).toHaveBeenCalledWith(undefined);
      expect(storage.remove).toHaveBeenCalledWith('/storage/incoming/upload-1');
    });
  });
});
