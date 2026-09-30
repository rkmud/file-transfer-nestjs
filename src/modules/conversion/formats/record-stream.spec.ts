/**
 * Streaming contract (009 / 013 §5.5 rows 5–7): converting record by record
 * through `readRecords` + `createWriter` must produce output byte-identical to
 * `serialize(parse(text))` on the whole document, for every direction.
 *
 * `streamConvert` mirrors the worker's streaming path (decodeTextStream →
 * readRecords → optional scan() replay → write()/end(), each pass guarded by
 * createRecordBudget) without touching the file system.
 */
import { CSV_VALUE_COLUMN, CsvFormatHandler } from './csv.format';
import {
  isStreamingSource,
  isStreamingTarget,
  StreamingSourceHandler,
  StreamingTargetHandler,
} from './format-handler';
import { createFormatRegistry } from './format-registry';
import { ParseLimits, TEXT_FORMATS, TextFormat } from './format.types';
import { assertStructureLimits, createRecordBudget } from './structure';
import { decodeText, decodeTextStream } from './text-codec';

const LIMITS: ParseLimits = {
  maxDepth: 32,
  maxNodes: 100_000,
  maxYamlAliases: 50,
};

const registry = createFormatRegistry();

const source = (format: TextFormat): StreamingSourceHandler => {
  const handler = registry.get(format);

  if (!isStreamingSource(handler)) throw new Error(`${format} cannot stream`);

  return handler;
};

const target = (format: TextFormat): StreamingTargetHandler => {
  const handler = registry.get(format);

  if (!isStreamingTarget(handler)) throw new Error(`${format} has no writer`);

  return handler;
};

async function* byteChunks(
  bytes: Buffer,
  size: number,
): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, offset + size);
  }
}

const streamConvert = async (
  from: StreamingSourceHandler,
  to: StreamingTargetHandler,
  bytes: Buffer,
  chunkSize: number,
  limits: ParseLimits = LIMITS,
): Promise<string> => {
  const writer = to.createWriter();
  const records = () =>
    from.readRecords(decodeTextStream(byteChunks(bytes, chunkSize)), limits);

  if (writer.needsScan) {
    const budget = createRecordBudget(limits);

    for await (const record of records()) {
      budget.consume(record);
      writer.scan?.(record);
    }
  }

  const budget = createRecordBudget(limits);
  let output = '';

  for await (const record of records()) {
    budget.consume(record);
    output += writer.write(record);
  }

  return output + writer.end();
};

const memoryConvert = (
  from: StreamingSourceHandler,
  to: StreamingTargetHandler,
  bytes: Buffer,
  limits: ParseLimits = LIMITS,
): string => {
  const data = from.parse(decodeText(bytes), limits);

  assertStructureLimits(data, limits);

  return to.serialize(data);
};

const writeAll = (to: StreamingTargetHandler, records: unknown[]): string => {
  const writer = to.createWriter();

  if (writer.needsScan) records.forEach((record) => writer.scan?.(record));

  return records.map((record) => writer.write(record)).join('') + writer.end();
};

const CSV_INPUTS: Record<string, string> = {
  'header with quoted commas, quotes, embedded newlines and unicode':
    '﻿id,name,note\r\n' +
    '1,Zoë 😀,"a, b"\r\n' +
    '2,"Bob ""the"" builder","line1\nline2\n  indented"\r\n' +
    '\r\n' +
    '3,€uro,\r\n',
  'headerless numeric rows': '1,2,3\n4,5,6\n',
  'a single row': 'only,one,row',
  'header only': 'a,b\n',
  'header and one row': 'city,zip\nKraków,30-001\n',
  'values that look like XML/YAML syntax':
    'k,v\n<tag>,"- item"\n"a: b","&amp; <![CDATA[x]]>"\n',
  empty: '',
};

const JSON_INPUTS: Record<string, string> = {
  'objects with nested objects and arrays': JSON.stringify([
    { id: 1, user: { name: 'Zoë', geo: { lat: 1.5, lng: -2 } }, tags: ['a'] },
    { id: 2, user: { name: 'Bob' }, tags: [] },
  ]),
  'ragged records': JSON.stringify([
    { a: 1 },
    { b: 'two', a: 3 },
    { c: { d: true } },
    {},
  ]),
  'XML text nodes containing newlines': JSON.stringify([
    { note: 'line1\nline2\n    deeply indented\n', title: 'x' },
    { note: '\nleading and trailing\n' },
    'bare\nscalar\nrecord',
  ]),
  'scalars and nulls': '[1, "two", true, null, 3.5, ""]',
  'arrays of arrays': '[[1, "a", null], [2, "b", {"x": [1]}], []]',
  'XML-special keys and characters': JSON.stringify([
    {
      '@id': '7',
      '#text': 'body & <b>',
      'bad key!': 1,
      bad_key_: 2,
      '9lives': 'cat',
      ctl: 'bell\u0007',
    },
  ]),
  'values that need YAML quoting': JSON.stringify([
    { v: 'yes' },
    { v: '0x1F' },
    { v: '- dash' },
    { v: 'key: value' },
    { v: '' },
    { v: 'multi\nline' },
  ]),
  'pretty-printed with unicode':
    '[\n  {\n    "name": "José 😀",\n    "city": "Zürich"\n  }\n]\n',
  empty: '[ ]',
};

const INPUTS: Array<[TextFormat, string, string]> = [
  ...Object.entries(CSV_INPUTS).map(
    ([label, text]) => ['csv', label, text] as [TextFormat, string, string],
  ),
  ...Object.entries(JSON_INPUTS).map(
    ([label, text]) => ['json', label, text] as [TextFormat, string, string],
  ),
];

const STREAMING_SOURCES: TextFormat[] = ['csv', 'json'];

describe('streaming conversion is byte-identical to serialize()', () => {
  it('covers every streaming source and every target', () => {
    expect(
      TEXT_FORMATS.filter((f) => isStreamingSource(registry.get(f))),
    ).toEqual(STREAMING_SOURCES);
    expect(TEXT_FORMATS.every((f) => isStreamingTarget(registry.get(f)))).toBe(
      true,
    );
  });

  describe.each(INPUTS)('%s source: %s', (from, _label, text) => {
    const bytes = Buffer.from(text, 'utf8');

    it.each([...TEXT_FORMATS])('→ %s', async (to) => {
      const expected = memoryConvert(source(from), target(to), bytes);

      for (const size of [1, 3, 17, Math.max(bytes.length, 1)]) {
        const actual = await streamConvert(
          source(from),
          target(to),
          bytes,
          size,
        );

        expect(actual).toBe(expected);
      }
    });
  });

  it('keeps XML text nodes with newlines exactly as in the source', async () => {
    const bytes = Buffer.from(
      JSON_INPUTS['XML text nodes containing newlines'],
    );
    const output = await streamConvert(source('json'), target('xml'), bytes, 5);

    expect(output).toContain(
      '<note>line1\nline2\n    deeply indented\n</note>',
    );
    expect(output).toContain('<item>bare\nscalar\nrecord</item>');
    expect(output).toBe(
      registry.get('xml').serialize(JSON.parse(bytes.toString())),
    );
  });

  it('streams a large CSV identically to the in-memory path', async () => {
    const rows = ['id,name,comment'];

    for (let i = 0; i < 2000; i++) {
      rows.push(`${i},user ${i} ü,"said ""hi""\nat ${i}"`);
    }

    const bytes = Buffer.from(rows.join('\r\n'));

    for (const to of TEXT_FORMATS) {
      expect(await streamConvert(source('csv'), target(to), bytes, 4096)).toBe(
        memoryConvert(source('csv'), target(to), bytes),
      );
    }
  });
});

describe('RecordWriter output equals serialize() over the whole collection', () => {
  const collections: Record<string, unknown[]> = {
    empty: [],
    objects: [
      { a: 1, b: { c: 'x' } },
      { a: 2, d: [1, 2] },
    ],
    'text with newlines': [{ t: 'l1\nl2\n  l3' }, { t: '\n' }],
    scalars: ['x', null, 3, true, undefined],
    'nested arrays': [[['deep']], [], [1, [2]]],
    'empty object': [{}],
    'scalars mixed with objects': ['x', { value: 'y', other: 1 }, 7],
    'xml attributes and text': [{ '@id': '1', '#text': 'a\nb' }, { '@': 'at' }],
  };

  describe.each(Object.entries(collections))('%s', (_label, records) => {
    it.each([...TEXT_FORMATS])('→ %s', (to) => {
      expect(writeAll(target(to), records)).toBe(target(to).serialize(records));
    });
  });

  // Divergence: when a CSV target receives arrays mixed with objects,
  // CsvRecordWriter.scan() skips array records, so the streamed header lacks the
  // "value" column that serialize() adds for them and the array rows are
  // written as empty cells (data loss). Reachable from a JSON array source such
  // as `[[1,2],{"a":1}]`. Marked `failing` so it flips once the writer is fixed.
  it.failing('→ csv with arrays mixed with objects', () => {
    const records = [[1, 2], { a: 1 }];
    const csv = target('csv');

    expect(writeAll(csv, records)).toBe(csv.serialize(records));
  });

  it('documents the current CSV output for arrays mixed with objects', async () => {
    const bytes = Buffer.from('[[1,2],{"a":1}]');

    expect(await streamConvert(source('json'), target('csv'), bytes, 4)).toBe(
      'a\r\n\r\n1\r\n',
    );
    expect(memoryConvert(source('json'), target('csv'), bytes)).toBe(
      'value,a\r\n"[1,2]",\r\n,1\r\n',
    );
  });
});

describe('CsvRecordWriter column union', () => {
  const csv = new CsvFormatHandler();

  const headerOf = (output: string): string => output.split('\r\n', 1)[0];

  it('scan() replay yields the same header as the in-memory path for ragged records', () => {
    const records = [
      { id: 1 },
      { name: 'x', id: 2 },
      { address: { city: 'Paris', geo: { lat: 1 } } },
      { tags: ['a'], id: 3, extra: null },
      'scalar',
    ];
    const writer = csv.createWriter();

    expect(writer.needsScan).toBe(true);
    records.forEach((record) => writer.scan?.(record));

    const streamed =
      records.map((r) => writer.write(r)).join('') + writer.end();

    expect(headerOf(streamed)).toBe(
      `id,name,address.city,address.geo.lat,tags,extra,${CSV_VALUE_COLUMN}`,
    );
    expect(headerOf(streamed)).toBe(headerOf(csv.serialize(records)));
    expect(streamed).toBe(csv.serialize(records));
  });

  it('writes the header once, before the first row', () => {
    const writer = csv.createWriter();

    writer.scan?.({ a: 1 });
    writer.scan?.({ b: 2 });

    expect(writer.write({ a: 1 })).toBe('a,b\r\n1,\r\n');
    expect(writer.write({ b: 2 })).toBe(',2\r\n');
    expect(writer.end()).toBe('');
  });

  it('writes no header when every record is an array', () => {
    const writer = csv.createWriter();
    const records = [
      ['1', '2'],
      ['3', null],
    ];

    records.forEach((record) => writer.scan?.(record));

    expect(records.map((r) => writer.write(r)).join('')).toBe('1,2\r\n3,\r\n');
    expect(writer.end()).toBe('');
  });

  it('writes nothing for an empty collection', () => {
    expect(csv.createWriter().end()).toBe('');
  });

  it('requires the scan pass: without it records are treated as arrays', () => {
    const arrays = csv.createWriter();

    expect(arrays.write(['1', 2])).toBe('1,2\r\n');
    expect(() => csv.createWriter().write({ a: 1 })).toThrow(TypeError);
  });
});

describe('record budget in the streaming path', () => {
  const json = source('json');

  it('enforces maxNodes across the whole document, not per record', async () => {
    // 1 (array) + 4 records x 3 nodes = 13 nodes; each record alone has 3.
    const bytes = Buffer.from(JSON.stringify(Array(4).fill({ a: 1, b: 2 })));
    const limits = { ...LIMITS, maxNodes: 12 };

    await expect(
      streamConvert(json, target('json'), bytes, 8, limits),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(() => memoryConvert(json, target('json'), bytes, limits)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }) as Error,
    );

    const roomy = { ...LIMITS, maxNodes: 13 };

    await expect(
      streamConvert(json, target('json'), bytes, 8, roomy),
    ).resolves.toBe(memoryConvert(json, target('json'), bytes, roomy));
  });

  it('enforces maxDepth relative to the document root', async () => {
    const bytes = Buffer.from('[{"a":{"b":{}}}]'); // depths 0,1,2,3
    const tight = { ...LIMITS, maxDepth: 3 };
    const enough = { ...LIMITS, maxDepth: 4 };

    await expect(
      streamConvert(json, target('yaml'), bytes, 2, tight),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(() => memoryConvert(json, target('yaml'), bytes, tight)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }) as Error,
    );
    await expect(
      streamConvert(json, target('yaml'), bytes, 2, enough),
    ).resolves.toBe(memoryConvert(json, target('yaml'), bytes, enough));
  });

  it('applies the budget to the CSV scan pass as well', async () => {
    const bytes = Buffer.from('a,b\n1,2\n3,4\n5,6\n'); // 1 + 3 x 3 = 10 nodes

    await expect(
      streamConvert(source('csv'), target('csv'), bytes, 3, {
        ...LIMITS,
        maxNodes: 9,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });
});
