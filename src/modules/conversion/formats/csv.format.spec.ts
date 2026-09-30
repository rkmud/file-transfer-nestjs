import * as csvSync from 'csv-parse/sync';
import { ConversionError } from './conversion-error';
import { CSV_VALUE_COLUMN, CsvFormatHandler } from './csv.format';
import { FormatMatch } from './format.types';
import { decodeTextStream } from './text-codec';

jest.mock('csv-parse/sync', () => {
  const actual =
    jest.requireActual<typeof import('csv-parse/sync')>('csv-parse/sync');

  return { ...actual, parse: jest.fn(actual.parse) };
});

async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

const splitEvery = (text: string, size: number): string[] => {
  const chunks: string[] = [];

  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push(text.slice(offset, offset + size));
  }

  return chunks;
};

const readAll = async (
  handler: CsvFormatHandler,
  source: AsyncIterable<string>,
): Promise<unknown[]> => {
  const records: unknown[] = [];

  for await (const record of handler.readRecords(source)) records.push(record);

  return records;
};

describe('CsvFormatHandler', () => {
  const handler = new CsvFormatHandler();

  it('declares its format metadata', () => {
    expect(handler.format).toBe('csv');
    expect(handler.extensions).toEqual(['.csv']);
    expect(handler.mimeType).toBe('text/csv');
    expect(handler.canStream()).toBe(true);
  });

  describe('sniff', () => {
    it.each([
      ['a,b,c\n1,2,3', FormatMatch.Likely],
      ['a,b\r\n1,2', FormatMatch.Likely],
      ['single column\nwith, comma later', FormatMatch.Possible],
      ['', FormatMatch.Possible],
      ['<root/>', FormatMatch.No],
      ['{"a":1}', FormatMatch.No],
      ['[1,2]', FormatMatch.No],
    ])('%j -> %s', (head, expected) => {
      expect(handler.sniff(head)).toBe(expected);
    });
  });

  describe('parse', () => {
    it('maps rows to objects keyed by the header row', () => {
      expect(
        handler.parse('id,name,note\n1,Zoë,"a, b"\n2,Bob,"multi\nline"\n'),
      ).toEqual([
        { id: '1', name: 'Zoë', note: 'a, b' },
        { id: '2', name: 'Bob', note: 'multi\nline' },
      ]);
    });

    it('skips empty lines', () => {
      expect(handler.parse('a,b\n\n1,2\n\n')).toEqual([{ a: '1', b: '2' }]);
    });

    it.each([
      [
        'numeric first row',
        '1,2\n3,4',
        [
          ['1', '2'],
          ['3', '4'],
        ],
      ],
      [
        'duplicate header cells',
        'a,a\n1,2',
        [
          ['a', 'a'],
          ['1', '2'],
        ],
      ],
      [
        'blank header cell',
        'a, \n1,2',
        [
          ['a', ' '],
          ['1', '2'],
        ],
      ],
      ['a single row', 'a,b', [['a', 'b']]],
      [
        'decimal-looking cells',
        '.5,1e3\nx,y',
        [
          ['.5', '1e3'],
          ['x', 'y'],
        ],
      ],
    ])('returns arrays when there is no header (%s)', (_l, text, rows) => {
      expect(handler.parse(text)).toEqual(rows);
    });

    it('returns an empty array for empty input', () => {
      expect(handler.parse('')).toEqual([]);
    });

    it('rethrows errors that are not CSV parse errors unchanged', () => {
      const failure = new RangeError('boom');

      jest.mocked(csvSync.parse).mockImplementationOnce(() => {
        throw failure;
      });

      expect(() => handler.parse('a,b')).toThrow(failure);
      expect(handler.parse('a,b\n1,2')).toEqual([{ a: '1', b: '2' }]);
    });

    it.each([
      ['an unclosed quote', '"a,b\n1,2'],
      ['a ragged row', 'a,b\n1'],
    ])('reports %s as SYNTAX_ERROR', (_l, text) => {
      expect(() => handler.parse(text)).toThrow(ConversionError);
      expect(() => handler.parse(text)).toThrow(
        expect.objectContaining({
          code: 'SYNTAX_ERROR',
          message: expect.stringMatching(/^Invalid CSV: /) as string,
        }) as Error,
      );
    });
  });

  describe('serialize', () => {
    it('writes objects with a header row and CRLF line endings', () => {
      expect(
        handler.serialize([
          { id: '1', name: 'Zoë' },
          { id: '2', name: 'with "quotes", commas' },
        ]),
      ).toBe('id,name\r\n1,Zoë\r\n2,"with ""quotes"", commas"\r\n');
    });

    it('flattens nested objects with dot notation and JSON-encodes arrays', () => {
      expect(
        handler.serialize([
          {
            id: 1,
            address: { city: 'Paris', geo: { lat: 1.5 } },
            tags: ['a', 'b'],
            empty: {},
            none: null,
          },
        ]),
      ).toBe(
        'id,address.city,address.geo.lat,tags,empty,none\r\n' +
          '1,Paris,1.5,"[""a"",""b""]",{},\r\n',
      );
    });

    it('uses the union of columns for ragged records', () => {
      expect(handler.serialize([{ a: 1 }, { b: 2, a: 3 }, { c: true }])).toBe(
        'a,b,c\r\n1,,\r\n3,2,\r\n,,true\r\n',
      );
    });

    it('writes arrays of arrays without a header', () => {
      expect(
        handler.serialize([
          [1, 'x', null],
          [{ a: 1 }, true],
        ]),
      ).toBe('1,x,\r\n"{""a"":1}",true\r\n');
    });

    it(`puts scalar records in a "${CSV_VALUE_COLUMN}" column`, () => {
      expect(handler.serialize(['a', 1, null, { value: 'x', other: 2 }])).toBe(
        'value,other\r\na,\r\n1,\r\n,\r\nx,2\r\n',
      );
    });

    it('unwraps single-key wrapper objects around the record array', () => {
      expect(handler.serialize({ data: { items: [{ a: 1 }, { a: 2 }] } })).toBe(
        'a\r\n1\r\n2\r\n',
      );
    });

    it('treats a multi-key object as a single record', () => {
      expect(handler.serialize({ a: 1, b: { c: 2 } })).toBe('a,b.c\r\n1,2\r\n');
    });

    it('treats a scalar document as a single value record', () => {
      expect(handler.serialize('hello')).toBe('value\r\nhello\r\n');
    });

    it('returns an empty string for an empty collection', () => {
      expect(handler.serialize([])).toBe('');
      expect(handler.serialize({ items: [] })).toBe('');
    });

    it('writes an empty object as an empty header and row', () => {
      expect(handler.serialize({})).toBe('\r\n\r\n');
    });
  });

  it('round-trips parse(serialize(records))', () => {
    const records = [
      { id: '1', name: 'Zoë 😀', note: 'line1\nline2' },
      { id: '2', name: 'x,y', note: '"quoted"' },
    ];

    expect(handler.parse(handler.serialize(records))).toEqual(records);
    expect(handler.sniff(handler.serialize(records))).toBe(FormatMatch.Likely);
  });

  describe('readRecords', () => {
    const text =
      'id,name,note\r\n1,Zoë,"a, b"\r\n\r\n2,Bob,"multi\nline"\r\n3,"😀",\r\n';

    it.each([1, 2, 5, Buffer.byteLength(text)])(
      'yields the same records as parse() from %i-byte chunks',
      async (size) => {
        const bytes = Buffer.from(text, 'utf8');

        async function* chunks(): AsyncGenerator<Buffer> {
          for (let i = 0; i < bytes.length; i += size) {
            yield bytes.subarray(i, i + size);
          }
        }

        await expect(
          readAll(handler, decodeTextStream(chunks())),
        ).resolves.toEqual(handler.parse(text));
      },
    );

    it('yields the same records as parse() from 1-char string chunks', async () => {
      const ascii = 'id,note\n1,"a,\nb"\n2,""""\n';

      await expect(
        readAll(handler, fromChunks(splitEvery(ascii, 1))),
      ).resolves.toEqual(handler.parse(ascii));
    });

    it.each([
      ['headerless rows', '1,2\n3,4\n5,6\n'],
      ['a single header-like row', 'a,b\n'],
      ['a single numeric row', '1,2'],
      ['a header plus one row', 'a,b\n1,2'],
      ['empty input', ''],
    ])('matches parse() for %s', async (_l, input) => {
      await expect(readAll(handler, fromChunks([input]))).resolves.toEqual(
        handler.parse(input),
      );
    });

    it('decodes byte chunks through decodeTextStream', async () => {
      async function* bytes(): AsyncGenerator<Buffer> {
        const buffer = Buffer.from('﻿name\nZoë\nJosé\n', 'utf8');

        for (let i = 0; i < buffer.length; i++) yield buffer.subarray(i, i + 1);
      }

      await expect(
        readAll(handler, decodeTextStream(bytes())),
      ).resolves.toEqual([{ name: 'Zoë' }, { name: 'José' }]);
    });

    it('reports a streaming CSV error as SYNTAX_ERROR', async () => {
      await expect(
        readAll(handler, fromChunks(['a,b\n1,2\n', '"unterminated'])),
      ).rejects.toMatchObject({
        code: 'SYNTAX_ERROR',
        message: expect.stringMatching(/^Invalid CSV: /) as string,
      });
    });

    it('rejects with INVALID_ENCODING when the decoded source fails mid-stream', async () => {
      async function* bytes(): AsyncGenerator<Buffer> {
        yield Buffer.from('name\nZo', 'utf8');
        yield Buffer.from([0xff, 0xfe, 0xfd]);
      }

      await expect(
        readAll(handler, decodeTextStream(bytes())),
      ).rejects.toMatchObject({
        code: 'INVALID_ENCODING',
        message: 'File is not valid UTF-8 text',
      });
    });

    it('rejects when the text source itself throws mid-stream', async () => {
      const failure = new ConversionError('INVALID_ENCODING', 'broken source');

      async function* failing(): AsyncGenerator<string> {
        yield 'a,b\n1,2\n';
        throw failure;
      }

      await expect(readAll(handler, failing())).rejects.toBe(failure);
    });
  });
});
