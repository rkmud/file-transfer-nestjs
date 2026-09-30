import { ConversionError } from './conversion-error';
import { readJsonArray } from './json-stream';

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

const readAll = async (chunks: string[]): Promise<unknown[]> => {
  const records: unknown[] = [];

  for await (const record of readJsonArray(fromChunks(chunks))) {
    records.push(record);
  }

  return records;
};

const readError = async (chunks: string[]): Promise<ConversionError> => {
  const error = await readAll(chunks).then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(ConversionError);

  return error as ConversionError;
};

describe('readJsonArray', () => {
  const documents = [
    '[]',
    ' \n\t[ ]\r\n',
    '[1]',
    '[1, -2.5e3, true, false, null, "x"]',
    '[{"a":1},{"b":[1,2,{"c":"d"}]}]',
    '[[1,[2,[3]]],[],{}]',
    '[{"s":"quote \\" bracket ] brace } comma , [ {"}]',
    '[{"s":"backslash \\\\"},"\\\\",{"t":"\\\\\\""}]',
    '["line1\\nline2", "tab\\t", "unicode é 😀 \\u00e9"]',
    '[\n  {\n    "id": 1,\n    "name": "Zoë"\n  },\n  {\n    "id": 2\n  }\n]\n',
    '[ 1 , "a" , {"x": [ ] } ]',
  ];

  it.each(documents)('matches JSON.parse for %j', async (document) => {
    const expected = JSON.parse(document) as unknown[];

    for (const size of [1, 2, 3, 7, document.length]) {
      await expect(readAll(splitEvery(document, size))).resolves.toEqual(
        expected,
      );
    }
  });

  it('yields records one at a time as soon as each is complete', async () => {
    const seen: unknown[] = [];
    const chunks = ['[{"a":1}', ',{"b":2}', ']'];
    let pulled = 0;

    async function* source(): AsyncGenerator<string> {
      for (const chunk of chunks) {
        pulled++;
        yield chunk;
      }
    }

    for await (const record of readJsonArray(source())) {
      seen.push({ record, pulled });
    }

    expect(seen).toEqual([
      { record: { a: 1 }, pulled: 1 },
      { record: { b: 2 }, pulled: 2 },
    ]);
  });

  it.each([
    ['{"a":1}', 0, 'document is not an array'],
    ['"x"', 0, 'document is not an array'],
    ['[] x', 3, 'unexpected trailing content'],
    ['[1]]', 3, 'unexpected trailing content'],
    ['[,1]', 1, 'unexpected comma'],
    ['[1,,2]', 3, 'unexpected comma'],
    ['[{"a":1} {"b":2}]', 9, 'expected "," or "]"'],
    ['[1', 2, 'unexpected end of input'],
    ['[{"a":1}', 8, 'unexpected end of input'],
    ['[1,', 3, 'unexpected end of input'],
    ['', 0, 'unexpected end of input'],
    ['   ', 3, 'unexpected end of input'],
  ])('rejects %j at position %i (%s)', async (document, position, detail) => {
    for (const size of [1, document.length || 1]) {
      const error = await readError(splitEvery(document, size));

      expect(error.code).toBe('SYNTAX_ERROR');
      expect(error.message).toBe(
        `Invalid JSON syntax at position ${position}: ${detail}`,
      );
    }
  });

  it('reports a record parse error at its absolute position', async () => {
    const error = await readError(splitEvery('[1, 1 2]', 2));

    expect(error.code).toBe('SYNTAX_ERROR');
    // "1 2" starts at offset 4; V8 reports the error at offset 2 within it.
    expect(error.message).toBe('Invalid JSON syntax at position 6');
  });

  it('reports a record parse error without a position when the engine gives none', async () => {
    const error = await readError(['[{"a":}]']);

    expect(error.code).toBe('SYNTAX_ERROR');
    expect(error.message).toMatch(/^Invalid JSON syntax/);
  });

  // Divergence: JSON.parse rejects a trailing comma, the streaming reader accepts it.
  it('accepts a trailing comma before the closing bracket (differs from JSON.parse)', async () => {
    expect(() => JSON.parse('[1,]') as unknown).toThrow();
    await expect(readAll(['[1,]'])).resolves.toEqual([1]);
  });

  it('propagates errors raised by the chunk source', async () => {
    async function* failing(): AsyncGenerator<string> {
      yield '[1,';
      throw new ConversionError('INVALID_ENCODING', 'bad bytes');
    }

    const records: unknown[] = [];
    const error = await (async () => {
      for await (const record of readJsonArray(failing())) records.push(record);
    })().then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(records).toEqual([1]);
    expect(error).toMatchObject({ code: 'INVALID_ENCODING' });
  });
});
