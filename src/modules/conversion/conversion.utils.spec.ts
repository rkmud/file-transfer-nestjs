import {
  CONVERSION_FALLBACK_FILE_NAME,
  CONVERSION_FILE_NAME_MAX_LENGTH,
} from './conversion.constants';
import { sanitizeFileName, toTransformationLog } from './conversion.utils';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from './entities/conversion.entity';

describe('sanitizeFileName', () => {
  it.each([
    ['data.csv', 'data.csv'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\file.json', 'file.json'],
    ['  spaced.yaml  ', 'spaced.yaml'],
    ['bad\u0000na\u001fme\u007f.xml', 'badname.xml'],
    ['cafe\u0301.csv', 'caf\u00e9.csv'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it.each([undefined, '', '   ', '.', '..', 'dir/', '\u0001'])(
    'falls back for %j',
    (input) => {
      expect(sanitizeFileName(input)).toBe(CONVERSION_FALLBACK_FILE_NAME);
    },
  );

  it('keeps a name of exactly the maximum length', () => {
    const name = `${'a'.repeat(CONVERSION_FILE_NAME_MAX_LENGTH - 4)}.csv`;

    expect(sanitizeFileName(name)).toBe(name);
  });

  it('truncates long names but keeps the extension', () => {
    const result = sanitizeFileName(`${'a'.repeat(400)}.json`);

    expect(result).toHaveLength(CONVERSION_FILE_NAME_MAX_LENGTH);
    expect(result.endsWith('.json')).toBe(true);
  });

  it('caps a very long extension at 16 characters', () => {
    const extension = `.${'x'.repeat(30)}`;
    const result = sanitizeFileName(`${'a'.repeat(300)}${extension}`);

    expect(result).toHaveLength(CONVERSION_FILE_NAME_MAX_LENGTH);
    expect(result.endsWith(extension.slice(0, 16))).toBe(true);
  });

  it('truncates long names without an extension', () => {
    expect(sanitizeFileName('b'.repeat(300))).toBe(
      'b'.repeat(CONVERSION_FILE_NAME_MAX_LENGTH),
    );
  });

  it('does not treat a leading dot as an extension', () => {
    const result = sanitizeFileName(`.${'c'.repeat(300)}`);

    expect(result).toBe(`.${'c'.repeat(CONVERSION_FILE_NAME_MAX_LENGTH - 1)}`);
  });
});

describe('toTransformationLog', () => {
  const base = (overrides: Partial<Conversion>): Conversion =>
    Object.assign(new Conversion(), {
      id: 'c-1',
      userId: 'u-1',
      type: ConversionType.File,
      inputFormat: 'csv',
      outputFormat: 'json',
      inputSize: 42,
      inputPath: 'inputs/u-1/c-1.csv',
      outputPath: 'outputs/u-1/c-1.json',
      durationMs: 12,
      errorReason: null,
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
      ...overrides,
    });

  it('maps a successful conversion', () => {
    expect(
      toTransformationLog(
        base({ status: ConversionStatus.Success, errorReason: 'ignored' }),
      ),
    ).toEqual({
      id: 'c-1',
      userId: 'u-1',
      type: 'file',
      sourceFormat: 'csv',
      targetFormat: 'json',
      status: 'success',
      errorCode: null,
      fileSize: 42,
      durationMs: 12,
      sourceFilePath: 'inputs/u-1/c-1.csv',
      targetFilePath: 'outputs/u-1/c-1.json',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    });
  });

  it('maps a failed conversion with its error reason and a zero duration fallback', () => {
    expect(
      toTransformationLog(
        base({
          status: ConversionStatus.Error,
          errorReason: 'SYNTAX_ERROR',
          durationMs: null,
          inputFormat: null,
          outputPath: null,
        }),
      ),
    ).toMatchObject({
      status: 'error',
      errorCode: 'SYNTAX_ERROR',
      durationMs: 0,
      sourceFormat: null,
      targetFilePath: null,
    });
  });
});
