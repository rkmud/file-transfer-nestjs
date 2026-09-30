import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, removeDir } from '../../../../test/setup/temp-dir';
import { CONVERSION_PARTIAL_SUFFIX } from '../conversion.constants';
import { ConversionError } from '../formats/conversion-error';
import { CsvFormatHandler } from '../formats/csv.format';
import { createFormatRegistry } from '../formats/format-registry';
import { ParseLimits, TextFormat } from '../formats/format.types';
import { JsonFormatHandler } from '../formats/json.format';
import { XmlFormatHandler } from '../formats/xml.format';
import { YamlFormatHandler } from '../formats/yaml.format';
import { ConversionTask } from './conversion.task';
import convert from './conversion.worker';

const LIMITS: ParseLimits = {
  maxDepth: 100,
  maxNodes: 100_000,
  maxYamlAliases: 10,
};

const CSV = 'id,name,note\n1,Alice,"line one\nline two"\n2,Bob,plain\n';
const JSON_ARRAY = JSON.stringify([
  { id: 1, name: 'Alice', tags: ['a'] },
  { id: 2, name: 'Bob', extra: true },
]);
const JSON_OBJECT = JSON.stringify({ people: [{ id: 1 }, { id: 2 }] });
const XML =
  '<root><item id="1"><name>Alice</name></item><item id="2"><name>Bob</name></item></root>';
const YAML = '- id: 1\n  name: Alice\n- id: 2\n  name: Bob\n';

const EXTENSIONS: Record<TextFormat, string> = {
  csv: '.csv',
  json: '.json',
  xml: '.xml',
  yaml: '.yaml',
};

const registry = createFormatRegistry();

describe('conversion.worker', () => {
  let dir: string;
  let counter = 0;

  beforeAll(() => {
    dir = makeTempDir('ftn-worker-');
  });

  afterAll(() => removeDir(dir));

  afterEach(() => jest.restoreAllMocks());

  const makeTask = (
    content: string,
    sourceFormat: TextFormat,
    targetFormat: TextFormat,
    overrides: Partial<ConversionTask> = {},
  ): ConversionTask & { finalPath: string } => {
    const id = `task-${++counter}`;
    const inputPath = join(dir, `${id}${EXTENSIONS[sourceFormat]}`);
    const finalPath = join(dir, `${id}${EXTENSIONS[targetFormat]}`);

    writeFileSync(inputPath, content);

    return {
      inputPath,
      inputSize: Buffer.byteLength(content),
      outputPath: `${finalPath}${CONVERSION_PARTIAL_SUFFIX}`,
      finalPath,
      sourceFormat,
      targetFormat,
      limits: LIMITS,
      streamThresholdBytes: 1024 * 1024,
      ...overrides,
    };
  };

  const expectedInMemory = (
    content: string,
    source: TextFormat,
    target: TextFormat,
  ): string =>
    registry.get(target).serialize(registry.get(source).parse(content, LIMITS));

  const spyPaths = () => ({
    parse: [
      jest.spyOn(CsvFormatHandler.prototype, 'parse'),
      jest.spyOn(JsonFormatHandler.prototype, 'parse'),
      jest.spyOn(XmlFormatHandler.prototype, 'parse'),
      jest.spyOn(YamlFormatHandler.prototype, 'parse'),
    ],
    readRecords: [
      jest.spyOn(CsvFormatHandler.prototype, 'readRecords'),
      jest.spyOn(JsonFormatHandler.prototype, 'readRecords'),
    ],
  });

  const calls = (spies: jest.SpyInstance[]): number =>
    spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);

  describe('path selection', () => {
    it.each<[TextFormat, TextFormat, string]>([
      ['csv', 'json', CSV],
      ['json', 'csv', JSON_ARRAY],
    ])(
      'uses the in-memory path below the threshold (%s -> %s)',
      async (source, target, content) => {
        const expected = expectedInMemory(content, source, target);
        const spies = spyPaths();
        const task = makeTask(content, source, target, {
          streamThresholdBytes: Buffer.byteLength(content) + 1,
        });

        const result = await convert(task);

        expect(result).toEqual({
          ok: true,
          outputSize: Buffer.byteLength(expected),
        });
        expect(calls(spies.parse)).toBe(1);
        expect(calls(spies.readRecords)).toBe(0);
      },
    );

    it.each<[TextFormat, TextFormat, string]>([
      ['csv', 'json', CSV],
      ['csv', 'xml', CSV],
      ['csv', 'yaml', CSV],
      ['json', 'csv', JSON_ARRAY],
      ['json', 'xml', JSON_ARRAY],
      ['json', 'yaml', JSON_ARRAY],
    ])(
      'streams at the threshold with byte-identical output (%s -> %s)',
      async (source, target, content) => {
        const expected = expectedInMemory(content, source, target);
        const spies = spyPaths();
        const task = makeTask(content, source, target, {
          streamThresholdBytes: Buffer.byteLength(content),
        });

        const result = await convert(task);

        expect(calls(spies.readRecords)).toBeGreaterThan(0);
        expect(calls(spies.parse)).toBe(0);
        expect(result).toEqual({
          ok: true,
          outputSize: Buffer.byteLength(expected),
        });
        expect(readFileSync(task.outputPath, 'utf8')).toBe(expected);
      },
    );

    it('streams above the threshold', async () => {
      const spies = spyPaths();
      const task = makeTask(CSV, 'csv', 'json', { streamThresholdBytes: 1 });

      await expect(convert(task)).resolves.toMatchObject({ ok: true });
      expect(calls(spies.readRecords)).toBeGreaterThan(0);
      expect(calls(spies.parse)).toBe(0);
    });

    it.each<[TextFormat, TextFormat, string]>([
      ['xml', 'json', XML],
      ['yaml', 'csv', YAML],
      ['json', 'yaml', JSON_OBJECT],
      ['json', 'xml', `  \n${JSON_OBJECT}`],
    ])(
      'always uses the in-memory path for %s sources that cannot stream (-> %s)',
      async (source, target, content) => {
        const expected = expectedInMemory(content, source, target);
        const spies = spyPaths();
        const canStream = jest.spyOn(JsonFormatHandler.prototype, 'canStream');
        const task = makeTask(content, source, target, {
          streamThresholdBytes: 1,
        });

        const result = await convert(task);

        expect(result).toMatchObject({ ok: true });
        expect(calls(spies.parse)).toBe(1);
        expect(calls(spies.readRecords)).toBe(0);
        expect(readFileSync(task.outputPath, 'utf8')).toBe(expected);
        if (source === 'json') {
          expect(canStream).toHaveBeenCalled();
        }
      },
    );

    it('skips empty writer chunks and an empty tail', async () => {
      jest.spyOn(JsonFormatHandler.prototype, 'createWriter').mockReturnValue({
        write: () => '',
        end: () => '',
      });
      const task = makeTask(CSV, 'csv', 'json', { streamThresholdBytes: 1 });

      await expect(convert(task)).resolves.toEqual({ ok: true, outputSize: 0 });
      expect(readFileSync(task.outputPath, 'utf8')).toBe('');
    });
  });

  describe('output files', () => {
    it.each([
      ['in-memory', 1024 * 1024],
      ['streaming', 1],
    ])(
      'writes only <id>.<ext>.part and never the final file (%s)',
      async (_label, threshold) => {
        const task = makeTask(CSV, 'csv', 'yaml', {
          streamThresholdBytes: threshold,
        });

        await expect(convert(task)).resolves.toMatchObject({ ok: true });
        expect(task.outputPath.endsWith('.yaml.part')).toBe(true);
        expect(existsSync(task.outputPath)).toBe(true);
        expect(existsSync(task.finalPath)).toBe(false);
      },
    );

    it('does not create any output when in-memory parsing fails', async () => {
      const task = makeTask('{"broken": ', 'json', 'csv');

      const result = await convert(task);

      expect(result).toMatchObject({ ok: false, code: 'SYNTAX_ERROR' });
      expect(existsSync(task.outputPath)).toBe(false);
      expect(existsSync(task.finalPath)).toBe(false);
    });

    it('does not promote the .part file when streaming fails midway', async () => {
      const task = makeTask('[{"a":1},{"a":2},{"a":', 'json', 'yaml', {
        streamThresholdBytes: 1,
      });

      const result = await convert(task);

      expect(result).toMatchObject({ ok: false });
      expect(existsSync(task.finalPath)).toBe(false);
    });

    it('refuses to overwrite an existing .part file', async () => {
      const task = makeTask(CSV, 'csv', 'json');

      writeFileSync(task.outputPath, 'stale');

      const result = await convert(task);

      // The fs error's name/message never leaks; only a generic INTERNAL code.
      expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
      expect(readFileSync(task.outputPath, 'utf8')).toBe('stale');
    });
  });

  describe('error mapping', () => {
    it('enforces structure limits document-wide on the streaming path', async () => {
      const task = makeTask(CSV, 'csv', 'json', {
        streamThresholdBytes: 1,
        limits: { ...LIMITS, maxNodes: 3 },
      });

      await expect(convert(task)).resolves.toMatchObject({
        ok: false,
        code: 'LIMIT_EXCEEDED',
      });
    });

    it('enforces structure limits during the CSV scan pass', async () => {
      const task = makeTask(JSON_ARRAY, 'json', 'csv', {
        streamThresholdBytes: 1,
        limits: { ...LIMITS, maxNodes: 3 },
      });

      await expect(convert(task)).resolves.toMatchObject({
        ok: false,
        code: 'LIMIT_EXCEEDED',
      });
    });

    it('enforces structure limits on the in-memory path', async () => {
      const task = makeTask(JSON_OBJECT, 'json', 'yaml', {
        limits: { ...LIMITS, maxDepth: 1 },
      });

      await expect(convert(task)).resolves.toMatchObject({
        ok: false,
        code: 'LIMIT_EXCEEDED',
      });
    });

    it('returns the code and message of a ConversionError', async () => {
      jest
        .spyOn(YamlFormatHandler.prototype, 'parse')
        .mockImplementation(() => {
          throw new ConversionError('FORBIDDEN_CONSTRUCT', 'Nope');
        });
      const task = makeTask(YAML, 'yaml', 'json');

      await expect(convert(task)).resolves.toEqual({
        ok: false,
        code: 'FORBIDDEN_CONSTRUCT',
        message: 'Nope',
      });
    });

    it('maps RangeError (e.g. stack overflow) to LIMIT_EXCEEDED', async () => {
      jest
        .spyOn(YamlFormatHandler.prototype, 'parse')
        .mockImplementation(() => {
          throw new RangeError('Maximum call stack size exceeded');
        });
      const task = makeTask(YAML, 'yaml', 'json');

      await expect(convert(task)).resolves.toEqual({
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: 'Document is too complex to convert',
      });
    });

    it('maps unknown errors to INTERNAL with only the error name', async () => {
      jest
        .spyOn(YamlFormatHandler.prototype, 'parse')
        .mockImplementation(() => {
          throw new TypeError('secret file content');
        });
      const task = makeTask(YAML, 'yaml', 'json');

      await expect(convert(task)).resolves.toEqual({
        ok: false,
        code: 'INTERNAL',
        message: 'TypeError',
      });
    });

    it('maps non-Error throwables to INTERNAL', async () => {
      jest
        .spyOn(YamlFormatHandler.prototype, 'parse')
        .mockImplementation(() => {
          throw 'boom';
        });
      const task = makeTask(YAML, 'yaml', 'json');

      await expect(convert(task)).resolves.toEqual({
        ok: false,
        code: 'INTERNAL',
        message: 'Unknown error',
      });
    });

    it('reports a missing input file as INTERNAL', async () => {
      const task = makeTask(CSV, 'csv', 'json', { streamThresholdBytes: 1 });

      await expect(
        convert({ ...task, inputPath: join(dir, 'missing.csv') }),
      ).resolves.toMatchObject({ ok: false, code: 'INTERNAL' });
    });
  });
});
