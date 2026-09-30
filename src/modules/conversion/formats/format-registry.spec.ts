import { ConversionError } from './conversion-error';
import { CsvFormatHandler } from './csv.format';
import { isStreamingSource, isStreamingTarget } from './format-handler';
import { createFormatRegistry, FormatRegistry } from './format-registry';
import { TEXT_FORMATS, TextFormat } from './format.types';

describe('FormatRegistry', () => {
  const registry = createFormatRegistry();

  it('registers one handler per TEXT_FORMATS entry', () => {
    expect(registry.all().map((handler) => handler.format)).toEqual([
      ...TEXT_FORMATS,
    ]);

    for (const format of TEXT_FORMATS) {
      expect(registry.has(format)).toBe(true);
      expect(registry.get(format).format).toBe(format);
    }
  });

  it('reports unknown formats', () => {
    expect(registry.has('pdf')).toBe(false);
    expect(() => registry.get('pdf' as TextFormat)).toThrow(
      'No handler registered for format "pdf"',
    );
  });

  it.each([
    ['.csv', 'csv'],
    ['.json', 'json'],
    ['.xml', 'xml'],
    ['.yaml', 'yaml'],
    ['.yml', 'yaml'],
  ])('finds %s -> %s', (extension, format) => {
    expect(registry.findByExtension(extension)?.format).toBe(format);
  });

  it('returns undefined for an unknown extension', () => {
    expect(registry.findByExtension('.txt')).toBeUndefined();
    expect(registry.findByExtension('')).toBeUndefined();
  });

  it('keeps the last handler registered for a format', () => {
    const first = new CsvFormatHandler();
    const second = new CsvFormatHandler();
    const custom = new FormatRegistry([first, second]);

    expect(custom.all()).toEqual([second]);
    expect(custom.get('csv')).toBe(second);
  });
});

describe('streaming capability guards', () => {
  const registry = createFormatRegistry();

  it.each([
    ['csv', true],
    ['json', true],
    ['xml', false],
    ['yaml', false],
  ] as const)('%s streaming source: %s', (format, expected) => {
    expect(isStreamingSource(registry.get(format))).toBe(expected);
  });

  it.each(TEXT_FORMATS)('%s is a streaming target', (format) => {
    expect(isStreamingTarget(registry.get(format))).toBe(true);
  });
});

describe('ConversionError', () => {
  it('carries a machine-readable code', () => {
    const error = new ConversionError('SYNTAX_ERROR', 'bad input');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConversionError');
    expect(error.code).toBe('SYNTAX_ERROR');
    expect(error.message).toBe('bad input');
  });
});
