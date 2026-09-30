import { Logger } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { createFormatRegistry } from '@/modules/conversion/formats/format-registry';
import { TextFormat } from '@/modules/conversion/formats/format.types';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from '@/modules/conversion/entities/conversion.entity';
import { ConversionStorage } from '@/modules/conversion/services/conversion-storage.service';
import { ConversionTimeoutError } from '@/modules/conversion/services/worker-pool';
import { ConversionTaskResult } from '@/modules/conversion/worker/conversion.task';
import { TransformationLog } from '@/modules/transformation-history/entities/transformation-log.entity';
import { User } from '@/modules/users/users.entity';
import { createTestApp, TestApp } from '../setup';

const FIXTURES = join(__dirname, '..', 'fixtures', 'text');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const FIXTURE_BY_FORMAT: Record<TextFormat, string> = {
  csv: 'people.csv',
  json: 'people.json',
  xml: 'people.xml',
  yaml: 'people.yaml',
};

const MIME: Record<TextFormat, string> = {
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'application/yaml',
};

const EXT: Record<TextFormat, string> = {
  csv: 'csv',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
};

const FORMATS: TextFormat[] = ['csv', 'json', 'xml', 'yaml'];
const DIRECTIONS = FORMATS.flatMap((source) =>
  FORMATS.filter((target) => target !== source).map(
    (target) => [source, target] as [TextFormat, TextFormat],
  ),
);

const LIMITS = { maxDepth: 100, maxNodes: 1_000_000, maxYamlAliases: 100 };
const registry = createFormatRegistry();
const expectedOutput = (source: TextFormat, target: TextFormat): string =>
  registry
    .get(target)
    .serialize(
      registry
        .get(source)
        .parse(fixture(FIXTURE_BY_FORMAT[source]).toString('utf8'), LIMITS),
    );

const asText = (
  res: request.Response,
  callback: (error: Error | null, body: string) => void,
): void => {
  let data = '';

  res.setEncoding('utf8');
  res.on('data', (chunk: string) => (data += chunk));
  res.on('end', () => callback(null, data));
};

const LOG_METHODS = [
  'log',
  'warn',
  'error',
  'debug',
  'verbose',
  'fatal',
] as const;

describe('Text conversion (009) — /api/convert', () => {
  let t: TestApp;
  let user: User;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestApp({
      env: {
        CSV_MAX_SIZE: '64',
        CONVERSION_TIMEOUT_MS: '1500',
      },
    });
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    user = await t.seedUser();
    cookie = t.authCookie(user);
  });

  afterEach(() => jest.restoreAllMocks());

  const conversions = (): Conversion[] => t.db.repo(Conversion).all();
  const logs = (): TransformationLog[] => t.db.repo(TransformationLog).all();

  const post = (
    content: Buffer | string,
    fileName: string,
    targetFormat?: string,
  ) => {
    let req = t
      .http()
      .post('/api/convert')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(content), fileName);

    if (targetFormat !== undefined)
      req = req.field('targetFormat', targetFormat);

    return req;
  };

  const incomingFiles = (): string[] => {
    try {
      return readdirSync(join(t.dirs.conversions, 'incoming'));
    } catch {
      return [];
    }
  };

  describe('POST /api/convert — supported directions', () => {
    it.each(DIRECTIONS)(
      '%s -> %s returns 200 with the converted payload',
      async (source, target) => {
        const res = await post(
          fixture(FIXTURE_BY_FORMAT[source]),
          FIXTURE_BY_FORMAT[source],
          target,
        )
          .buffer(true)
          .parse(asText);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe(
          `${MIME[target]}; charset=utf-8`,
        );
        expect(res.headers['content-disposition']).toBe(
          `attachment; filename="converted.${EXT[target]}"`,
        );
        expect(res.body).toBe(expectedOutput(source, target));
        expect(Number(res.headers['content-length'])).toBe(
          Buffer.byteLength(res.body as string),
        );
      },
    );

    it('converts CSV to JSON with header keys', async () => {
      const res = await post(fixture('people.csv'), 'people.csv', 'json');

      expect(res.status).toBe(200);
      expect(JSON.parse(res.text)).toEqual([
        { id: '1', name: 'Alice', city: 'Berlin' },
        { id: '2', name: 'Bob', city: 'Paris' },
      ]);
    });

    it('converts JSON to XML under a single <root> element', async () => {
      const res = await post(fixture('people.json'), 'people.json', 'xml');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(
        /<root>[\s\S]*<name>Alice<\/name>[\s\S]*<\/root>/,
      );
    });

    it('maps XML attributes to @-prefixed fields', async () => {
      const res = await post(fixture('people.xml'), 'people.xml', 'json');

      expect(res.status).toBe(200);
      expect(res.text).toContain('"@id"');
    });

    it('detects the source format from content for a .txt upload', async () => {
      const res = await post(fixture('people.yaml'), 'people.txt', 'json');

      expect(res.status).toBe(200);
      expect(conversions()[0].inputFormat).toBe('yaml');
    });

    it('does not leave the upload behind in the incoming directory', async () => {
      await post(fixture('people.csv'), 'people.csv', 'json').expect(200);

      expect(incomingFiles()).toEqual([]);
    });
  });

  describe('POST /api/convert — request validation', () => {
    it('400 when the file is missing (no conversion row)', async () => {
      const res = await t
        .http()
        .post('/api/convert')
        .set('Cookie', cookie)
        .field('targetFormat', 'json');

      expect(res.status).toBe(400);
      expect(conversions()).toHaveLength(0);
    });

    it('400 when the file is empty', async () => {
      const res = await post(Buffer.alloc(0), 'empty.csv', 'json');

      expect(res.status).toBe(400);
      expect(conversions()).toHaveLength(0);
    });

    it('400 when targetFormat is missing (no conversion row, upload cleaned)', async () => {
      const remove = jest.spyOn(
        t.get<ConversionStorage>(ConversionStorage),
        'remove',
      );

      const res = await post(fixture('people.csv'), 'people.csv');

      expect(res.status).toBe(400);
      expect(conversions()).toHaveLength(0);
      // The interceptor removes the upload in the background; wait for it.
      await Promise.all(remove.mock.results.map((r) => r.value));
      expect(remove).toHaveBeenCalledWith(expect.stringContaining('incoming'));
      expect(incomingFiles()).toEqual([]);
    });

    it('400 when targetFormat is longer than allowed', async () => {
      const res = await post(
        fixture('people.csv'),
        'people.csv',
        'x'.repeat(17),
      );

      expect(res.status).toBe(400);
    });

    it('415 for an unsupported target format (no conversion row)', async () => {
      const res = await post(fixture('people.csv'), 'people.csv', 'pdf');

      expect(res.status).toBe(415);
      expect(res.body.message).toBe('Unsupported target format "pdf"');
      expect(conversions()).toHaveLength(0);
    });

    it('415 when source and target formats are the same', async () => {
      const res = await post(fixture('people.json'), 'people.json', 'json');

      expect(res.status).toBe(415);
      expect(res.body.message).toBe(
        'Conversion from json to json is not supported',
      );
      expect(conversions()[0]).toMatchObject({
        status: ConversionStatus.Error,
        errorCode: 415,
        errorReason: 'UNSUPPORTED_FORMAT',
      });
    });

    it('400 with the parser message for a syntax error', async () => {
      const res = await post(fixture('invalid.json'), 'invalid.json', 'csv');

      expect(res.status).toBe(400);
      expect(typeof res.body.message).toBe('string');
      expect(res.body.message).toMatch(/JSON/);
      expect(conversions()[0]).toMatchObject({
        status: ConversionStatus.Error,
        errorCode: 400,
        errorReason: 'SYNTAX_ERROR',
      });
    });
  });

  describe('POST /api/convert — limits and detection', () => {
    it('413 FILE_TOO_LARGE above the per-format limit (CSV_MAX_SIZE=64)', async () => {
      const big = `id,name\n${'1,abcdefghij\n'.repeat(10)}`;

      const res = await post(big, 'big.csv', 'json');

      expect(res.status).toBe(413);
      expect(res.body.message).toBe('CSV files are limited to 64 bytes');
      expect(conversions()[0]).toMatchObject({
        status: ConversionStatus.Error,
        errorCode: 413,
        errorReason: 'FILE_TOO_LARGE',
        inputFormat: 'csv',
      });
      expect(logs()[0]).toMatchObject({ errorCode: 'FILE_TOO_LARGE' });
    });

    it('accepts a file exactly at the per-format limit', async () => {
      const exact = `a,b\n${'1,2\n'.repeat(15)}`;

      expect(Buffer.byteLength(exact)).toBe(64);
      await post(exact, 'exact.csv', 'json').expect(200);
    });

    it('415 for an unknown source extension', async () => {
      const res = await post(fixture('undetectable.bin'), 'blob.bin', 'json');

      expect(res.status).toBe(415);
      expect(conversions()[0]).toMatchObject({
        status: ConversionStatus.Error,
        errorCode: 415,
        errorReason: 'UNSUPPORTED_FORMAT',
        inputFormat: null,
      });
      expect(logs()[0]).toMatchObject({ sourceFormat: 'unknown' });
      expect(incomingFiles()).toEqual([]);
    });

    it.each(['blank.txt', 'blank'])(
      '415 when the content cannot be detected (%s)',
      async (name) => {
        const res = await post(fixture('blank.txt'), name, 'json');

        expect(res.status).toBe(415);
        expect(res.body.message).toBe('Unable to detect the source format');
        expect(conversions()[0].errorReason).toBe('UNSUPPORTED_FORMAT');
      },
    );

    it('400 INVALID_ENCODING for binary content with a generic extension', async () => {
      const res = await post(fixture('undetectable.bin'), 'blob.txt', 'json');

      expect(res.status).toBe(400);
      expect(conversions()[0].errorReason).toBe('INVALID_ENCODING');
    });

    it('415 when the content contradicts the extension', async () => {
      const res = await post('<root><a>1</a></root>', 'data.json', 'yaml');

      expect(res.status).toBe(415);
      expect(res.body.message).toBe(
        'File content does not match the .json extension',
      );
    });
  });

  describe('POST /api/convert — worker timeout', () => {
    it('408 when the worker pool times out, recorded as TIMEOUT', async () => {
      const lingering = jest
        .spyOn(t.get<ConversionStorage>(ConversionStorage), 'removeLingering')
        .mockResolvedValue(undefined);

      t.conversionPool.run.mockRejectedValueOnce(new ConversionTimeoutError());

      const res = await post(fixture('people.csv'), 'people.csv', 'json');

      expect(res.status).toBe(408);
      expect(res.body.message).toBe(
        'Conversion exceeded the 1500 ms time limit',
      );
      const [row] = conversions();

      expect(row).toMatchObject({
        status: ConversionStatus.Error,
        errorCode: 408,
        errorReason: 'TIMEOUT',
      });
      expect(lingering).toHaveBeenCalledWith(
        join(t.dirs.conversions, 'outputs', user.id, `${row.id}.json.part`),
      );
      expect(logs()[0]).toMatchObject({ id: row.id, errorCode: 'TIMEOUT' });
    });

    it('500 when the worker crashes with an unexpected error', async () => {
      t.conversionPool.run.mockRejectedValueOnce(new Error('worker died'));

      const res = await post(fixture('people.csv'), 'people.csv', 'json');

      expect(res.status).toBe(500);
      expect(conversions()[0]).toMatchObject({
        errorCode: 500,
        errorReason: 'INTERNAL',
      });
    });
  });

  describe('conversions history rows', () => {
    it('PROCESSING while the worker runs, then SUCCESS', async () => {
      let during: Conversion | undefined;
      const worker = t.conversionPool.run.getMockImplementation()!;

      t.conversionPool.run.mockImplementationOnce(
        async (task: unknown): Promise<ConversionTaskResult> => {
          during = { ...conversions()[0] };

          return worker(task);
        },
      );

      await post(fixture('people.csv'), 'people.csv', 'yaml').expect(200);

      expect(during).toMatchObject({
        status: ConversionStatus.Processing,
        userId: user.id,
        type: ConversionType.File,
        inputFileName: 'people.csv',
        outputFormat: 'yaml',
      });
      const [row] = conversions();

      expect(conversions()).toHaveLength(1);
      expect(row).toMatchObject({
        id: during!.id,
        status: ConversionStatus.Success,
        type: 'file',
        inputFormat: 'csv',
        inputSize: fixture('people.csv').length,
        inputPath: `inputs/${user.id}/${row.id}.csv`,
        outputPath: `outputs/${user.id}/${row.id}.yaml`,
        outputFileName: 'converted.yaml',
        errorCode: null,
        errorReason: null,
      });
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(
        readFileSync(join(t.dirs.conversions, row.outputPath!), 'utf8'),
      ).toBe(expectedOutput('csv', 'yaml'));
      expect(
        readdirSync(join(t.dirs.conversions, 'outputs', user.id)).filter((f) =>
          f.endsWith('.part'),
        ),
      ).toEqual([]);
    });

    it('a completed conversion produces exactly one transformation_logs row keyed by the conversion id', async () => {
      await post(fixture('people.xml'), 'people.xml', 'csv').expect(200);

      const [row] = conversions();

      expect(logs()).toHaveLength(1);
      expect(logs()[0]).toMatchObject({
        id: row.id,
        userId: user.id,
        type: 'file',
        sourceFormat: 'xml',
        targetFormat: 'csv',
        status: 'success',
        errorCode: null,
        fileSize: row.inputSize,
        sourceFilePath: row.inputPath,
        targetFilePath: row.outputPath,
      });
    });

    it('a failed conversion also produces exactly one transformation_logs row', async () => {
      await post(fixture('invalid.json'), 'invalid.json', 'xml').expect(400);

      expect(logs()).toHaveLength(1);
      expect(logs()[0]).toMatchObject({
        id: conversions()[0].id,
        status: 'error',
        errorCode: 'SYNTAX_ERROR',
        targetFilePath: null,
      });
    });
  });

  describe('logging', () => {
    it('sends the parser error to the client but never logs file content', async () => {
      const messages: string[] = [];

      for (const method of LOG_METHODS) {
        jest
          .spyOn(Logger.prototype, method)
          .mockImplementation((...args: unknown[]) => {
            messages.push(args.map(String).join(' '));
          });
      }
      const stdout = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const stderr = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      const res = await post(fixture('invalid.json'), 'invalid.json', 'yaml');

      const written = [...stdout.mock.calls, ...stderr.mock.calls]
        .map(([chunk]) => String(chunk))
        .join('');

      stdout.mockRestore();
      stderr.mockRestore();

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid JSON syntax/);
      expect(messages.join('\n')).toContain('Conversion failed:');
      expect(messages.join('\n')).toMatch(
        new RegExp(
          `userId=${user.id} sourceFormat=json targetFormat=yaml fileSize=\\d+ durationMs=\\d+ result=error code=400`,
        ),
      );
      for (const text of [messages.join('\n'), written]) {
        expect(text).not.toContain('SECRET-CONTENT-MARKER-42');
        expect(text).not.toContain('"broken"');
        expect(text).not.toContain(res.body.message);
      }
    });

    it('logs a success summary without content', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await post(fixture('people.csv'), 'people.csv', 'json').expect(200);

      const text = log.mock.calls.map((args) => args.join(' ')).join('\n');

      expect(text).toContain('result=success');
      expect(text).not.toContain('Alice');
    });
  });

  describe('GET /api/convert/formats', () => {
    it('returns the 12 supported directions', async () => {
      const res = await t
        .http()
        .get('/api/convert/formats')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body).toEqual([
        { source: 'csv', target: ['json', 'xml', 'yaml'] },
        { source: 'json', target: ['csv', 'xml', 'yaml'] },
        { source: 'xml', target: ['csv', 'json', 'yaml'] },
        { source: 'yaml', target: ['csv', 'json', 'xml'] },
      ]);
    });
  });

  describe('authentication', () => {
    const cookies = (): [string, string | undefined][] => [
      ['no cookie', undefined],
      ['an invalid token', 'access_token=not-a-jwt'],
      [
        'a refresh token as access token',
        `access_token=${t.refreshToken(user)}`,
      ],
    ];

    it('GET /api/convert/formats → 401', async () => {
      for (const [, value] of cookies()) {
        const req = t.http().get('/api/convert/formats');

        if (value) req.set('Cookie', value);
        await req.expect(401);
      }
    });

    it('POST /api/convert → 401 without creating a row', async () => {
      for (const [, value] of cookies()) {
        const req = t
          .http()
          .post('/api/convert')
          .attach('file', fixture('people.csv'), 'people.csv')
          .field('targetFormat', 'json');

        if (value) req.set('Cookie', value);
        await req.expect(401);
      }

      expect(conversions()).toHaveLength(0);
      expect(t.conversionPool.run).not.toHaveBeenCalled();
    });
  });
});
