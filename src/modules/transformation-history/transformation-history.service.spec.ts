import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InMemoryDatabase } from '../../../test/setup/in-memory-database';
import { InMemoryRepository } from '../../../test/setup/in-memory-repository';
import {
  toCursorTimestamp,
  transformationHistoryQueryResolver,
} from '../../../test/setup/transformation-history-query-resolver';
import { toTransformationLog } from '@/modules/conversion/conversion.utils';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from '@/modules/conversion/entities/conversion.entity';
import { UsersService } from '@/modules/users/users.service';
import { TransformationHistoryQueryDto } from './dto/transformation-history.dto';
import { TransformationLog } from './entities/transformation-log.entity';
import {
  decodeTransformationHistoryCursor,
  encodeTransformationHistoryCursor,
} from './transformation-history-cursor';
import { TransformationHistoryService } from './transformation-history.service';
import { TransformationLogInput } from './transformation-history.types';

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const query = (
  overrides: Partial<TransformationHistoryQueryDto> = {},
): TransformationHistoryQueryDto =>
  ({ limit: 20, ...overrides }) as TransformationHistoryQueryDto;

const conversion = (overrides: Partial<Conversion> = {}): Conversion =>
  Object.assign(new Conversion(), {
    id: id(1),
    userId: USER_A,
    type: ConversionType.File,
    inputFileName: 'in.csv',
    inputFormat: 'csv',
    inputSize: 123,
    inputPath: 'user/in.csv',
    outputFormat: 'json',
    outputPath: 'user/out.json',
    status: ConversionStatus.Success,
    errorCode: null,
    errorReason: null,
    durationMs: 42,
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    ...overrides,
  });

const logInput = (
  overrides: Partial<TransformationLogInput> = {},
): TransformationLogInput => ({
  id: id(1),
  userId: USER_A,
  type: 'file',
  sourceFormat: 'csv',
  targetFormat: 'json',
  status: 'success',
  errorCode: null,
  fileSize: 10,
  durationMs: 5,
  sourceFilePath: 'a/in.csv',
  targetFilePath: 'a/out.json',
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
  ...overrides,
});

describe('toTransformationLog', () => {
  it('maps a successful conversion', () => {
    expect(toTransformationLog(conversion())).toEqual({
      id: id(1),
      userId: USER_A,
      type: 'file',
      sourceFormat: 'csv',
      targetFormat: 'json',
      status: 'success',
      errorCode: null,
      fileSize: 123,
      durationMs: 42,
      sourceFilePath: 'user/in.csv',
      targetFilePath: 'user/out.json',
      createdAt: new Date('2026-01-15T10:00:00.000Z'),
    });
  });

  it('ignores a stale errorReason on success and defaults durationMs to 0', () => {
    const log = toTransformationLog(
      conversion({ errorReason: 'SYNTAX_ERROR', durationMs: null }),
    );

    expect(log.errorCode).toBeNull();
    expect(log.durationMs).toBe(0);
  });

  it('maps a failure before detection: null source format and source path', () => {
    const log = toTransformationLog(
      conversion({
        type: ConversionType.Image,
        status: ConversionStatus.Error,
        inputFormat: null,
        inputPath: null,
        outputPath: null,
        errorCode: 415,
        errorReason: 'UNSUPPORTED_FORMAT',
      }),
    );

    expect(log).toMatchObject({
      type: 'image',
      status: 'error',
      sourceFormat: null,
      sourceFilePath: null,
      targetFilePath: null,
      errorCode: 'UNSUPPORTED_FORMAT',
    });
  });

  it.each([
    'SYNTAX_ERROR',
    'INVALID_ENCODING',
    'INVALID_IMAGE',
    'VECTORIZATION_NOT_SUPPORTED',
    'TIMEOUT',
    'FILE_TOO_LARGE',
    'UNSUPPORTED_FORMAT',
  ])('passes error code %s through from errorReason', (reason) => {
    expect(
      toTransformationLog(
        conversion({ status: ConversionStatus.Error, errorReason: reason }),
      ).errorCode,
    ).toBe(reason);
  });
});

describe('TransformationHistoryService', () => {
  let db: InMemoryDatabase;
  let repo: InMemoryRepository<TransformationLog>;
  let usersService: { getUserById: jest.Mock };
  let service: TransformationHistoryService;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    db = new InMemoryDatabase();
    repo = db.repo(TransformationLog);
    repo.setQueryResolver(transformationHistoryQueryResolver);
    usersService = { getUserById: jest.fn() };
    service = new TransformationHistoryService(
      repo as never,
      usersService as unknown as UsersService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('record()', () => {
    it('inserts a row, storing "unknown" when the source format is null', async () => {
      await service.record(logInput({ sourceFormat: null }));

      expect(repo.all()).toHaveLength(1);
      expect(repo.all()[0]).toMatchObject({
        id: id(1),
        sourceFormat: 'unknown',
        isStored: false,
        expiresAt: null,
      });
    });

    it('upserts by id instead of duplicating', async () => {
      await service.record(logInput({ status: 'error', errorCode: 'TIMEOUT' }));
      await service.record(logInput({ status: 'success', errorCode: null }));

      expect(repo.all()).toHaveLength(1);
      expect(repo.all()[0]).toMatchObject({
        status: 'success',
        errorCode: null,
      });
    });

    it('never throws: a repository failure is swallowed and logged', async () => {
      jest.spyOn(repo, 'upsert').mockRejectedValueOnce(new Error('db down'));

      await expect(service.record(logInput())).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(`transformationId=${id(1)}`),
      );
    });
  });

  describe('list query', () => {
    const seed = (count: number, userId = USER_A) =>
      Array.from({ length: count }, (_, i) =>
        repo.seed({
          ...logInput({
            id: id(100 + i),
            userId,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          }),
          sourceFormat: 'csv',
        }),
      );

    it('builds the keyset query: to_char cursor alias, DESC ordering, limit + 1', async () => {
      seed(3);
      const first = await service.listOwn(USER_A, query({ limit: 2 }));

      await service.listOwn(
        USER_A,
        query({ limit: 2, cursor: first.pageInfo.nextCursor! }),
      );

      const [initial, next] = repo.queries;
      const methods = initial.calls.map((c) => c.method);

      expect(initial.alias).toBe('log');
      expect(initial.calls).toEqual(
        expect.arrayContaining([
          {
            method: 'addSelect',
            args: [
              expect.stringContaining(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`),
              'cursor_created_at',
            ],
          },
          { method: 'orderBy', args: ['log.createdAt', 'DESC'] },
          { method: 'addOrderBy', args: ['log.id', 'DESC'] },
          { method: 'limit', args: [3] },
        ]),
      );
      expect(methods.indexOf('orderBy')).toBeLessThan(
        methods.indexOf('addOrderBy'),
      );
      expect(initial.wheres).toEqual(['"log"."user_id" = :userId']);
      expect(next.wheres).toContain(
        '("log"."created_at", "log"."id") < (CAST(:cursorCreatedAt AS timestamptz), CAST(:cursorId AS uuid))',
      );
      expect(next.params).toMatchObject({
        cursorCreatedAt: toCursorTimestamp(
          new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
        ),
        cursorId: id(101),
      });
    });

    it('returns the page envelope with a cursor built from the raw to_char value', async () => {
      seed(3);
      const page = await service.listOwn(USER_A, query({ limit: 2 }));

      expect(page.items.map((i) => i.id)).toEqual([id(102), id(101)]);
      expect(page.pageInfo).toMatchObject({ limit: 2, hasMore: true });
      expect(
        decodeTransformationHistoryCursor(page.pageInfo.nextCursor!),
      ).toEqual({
        createdAt: '2026-01-01T00:00:01.000000Z',
        id: id(101),
      });
      expect(Object.keys(page.items[0]).sort()).toEqual(
        [
          'createdAt',
          'durationMs',
          'errorCode',
          'expiresAt',
          'fileSize',
          'id',
          'isStored',
          'sourceFormat',
          'status',
          'targetFormat',
          'type',
          'userId',
        ].sort(),
      );
    });

    it('ends with hasMore=false and no cursor', async () => {
      seed(2);
      const page = await service.listOwn(USER_A, query({ limit: 2 }));

      expect(page.items).toHaveLength(2);
      expect(page.pageInfo).toEqual({
        limit: 2,
        hasMore: false,
        nextCursor: null,
      });
    });

    it('returns an empty page', async () => {
      const page = await service.listOwn(USER_A, query());

      expect(page).toEqual({
        items: [],
        pageInfo: { limit: 20, hasMore: false, nextCursor: null },
      });
    });

    it('omits nextCursor when the raw row for the last item is missing', async () => {
      seed(3);
      repo.setQueryResolver((ctx) => ({
        ...transformationHistoryQueryResolver(ctx),
        raw: [],
      }));

      const page = await service.listOwn(USER_A, query({ limit: 1 }));

      expect(page.pageInfo).toEqual({
        limit: 1,
        hasMore: true,
        nextCursor: null,
      });
    });

    it('rejects a malformed cursor with 400 before querying', async () => {
      await expect(
        service.listOwn(USER_A, query({ cursor: 'garbage' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.queries).toHaveLength(0);
    });

    it('applies no filter other than userId when none is given', async () => {
      await service.listOwn(USER_A, query());

      expect(repo.queries[0].wheres).toEqual(['"log"."user_id" = :userId']);
      expect(repo.queries[0].params).toEqual({ userId: USER_A });
    });

    it('applies and combines every filter', async () => {
      const from = '2026-01-01T00:00:00.000Z';
      const to = '2026-02-01T00:00:00.000Z';

      await service.listOwn(
        USER_A,
        query({
          type: 'image',
          status: 'error',
          sourceFormat: 'png',
          targetFormat: 'jpeg',
          createdAtFrom: from,
          createdAtTo: to,
        }),
      );

      const [q] = repo.queries;

      expect(q.wheres).toEqual([
        '"log"."user_id" = :userId',
        '"log"."type" = :type',
        '"log"."status" = :status',
        '"log"."source_format" = :sourceFormat',
        '"log"."target_format" = :targetFormat',
        '"log"."created_at" >= :createdAtFrom',
        '"log"."created_at" <= :createdAtTo',
      ]);
      expect(q.params).toEqual({
        userId: USER_A,
        type: 'image',
        status: 'error',
        sourceFormat: 'png',
        targetFormat: 'jpeg',
        createdAtFrom: new Date(from),
        createdAtTo: new Date(to),
      });
    });

    it('filters the returned rows', async () => {
      repo.seed(
        { ...logInput({ id: id(1), type: 'image', status: 'error' }) } as never,
        { ...logInput({ id: id(2), type: 'file' }) } as never,
      );

      const page = await service.listOwn(
        USER_A,
        query({ type: 'image', status: 'error' }),
      );

      expect(page.items.map((i) => i.id)).toEqual([id(1)]);
    });

    it('rejects createdAtFrom later than createdAtTo', async () => {
      await expect(
        service.listOwn(
          USER_A,
          query({
            createdAtFrom: '2026-02-01T00:00:00Z',
            createdAtTo: '2026-01-01T00:00:00Z',
          }),
        ),
      ).rejects.toThrow('createdAtFrom must not be later than createdAtTo');
    });

    it('accepts a single-sided date range', async () => {
      await service.listOwn(
        USER_A,
        query({ createdAtTo: '2026-01-01T00:00:00Z' }),
      );

      expect(repo.queries[0].wheres).toContain(
        '"log"."created_at" <= :createdAtTo',
      );
      expect(repo.queries[0].params.createdAtFrom).toBeUndefined();
    });
  });

  describe('listForAdmin()', () => {
    it('lists every user when no userId is given', async () => {
      repo.seed(
        logInput({ id: id(1) }) as never,
        logInput({ id: id(2), userId: USER_B }) as never,
      );

      const page = await service.listForAdmin(USER_A, query());

      expect(page.items).toHaveLength(2);
      expect(repo.queries[0].wheres).toEqual([]);
      expect(usersService.getUserById).not.toHaveBeenCalled();
    });

    it('narrows to an existing user', async () => {
      usersService.getUserById.mockResolvedValue({ id: USER_B });
      repo.seed(
        logInput({ id: id(1) }) as never,
        logInput({ id: id(2), userId: USER_B }) as never,
      );

      const page = await service.listForAdmin(USER_A, query(), USER_B);

      expect(page.items.map((i) => i.id)).toEqual([id(2)]);
      expect(repo.queries[0].params.userId).toBe(USER_B);
    });

    it('throws 404 for an unknown user', async () => {
      usersService.getUserById.mockResolvedValue(null);

      await expect(
        service.listForAdmin(USER_A, query(), USER_B),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.queries).toHaveLength(0);
    });
  });

  describe('query DTO limit bounds', () => {
    const errorsFor = async (input: Record<string, unknown>) =>
      (
        await validate(plainToInstance(TransformationHistoryQueryDto, input))
      ).map((e) => e.property);

    it('defaults to 20', () => {
      expect(plainToInstance(TransformationHistoryQueryDto, {}).limit).toBe(20);
    });

    it.each([['1'], ['100']])('accepts limit=%s', async (limit) => {
      expect(await errorsFor({ limit })).toEqual([]);
    });

    it.each([['0'], ['101'], ['1.5'], ['abc']])(
      'rejects limit=%s',
      async (limit) => {
        expect(await errorsFor({ limit })).toEqual(['limit']);
      },
    );

    it('rejects an oversized cursor', async () => {
      expect(
        await errorsFor({
          cursor: encodeTransformationHistoryCursor({
            createdAt: 'x'.repeat(600),
            id: 'y',
          }),
        }),
      ).toEqual(['cursor']);
    });
  });
});
