import { ConversionError } from './conversion-error';
import { decodeHead, decodeText, decodeTextStream } from './text-codec';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function* fromChunks(chunks: Buffer[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) yield chunk;
}

const splitEvery = (buffer: Buffer, size: number): Buffer[] => {
  const chunks: Buffer[] = [];

  for (let offset = 0; offset < buffer.length; offset += size) {
    chunks.push(buffer.subarray(offset, offset + size));
  }

  return chunks;
};

const collect = async (chunks: Buffer[]): Promise<string[]> => {
  const out: string[] = [];

  for await (const text of decodeTextStream(fromChunks(chunks))) {
    out.push(text);
  }

  return out;
};

const expectEncodingError = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(ConversionError);
  expect(error).toMatchObject({ code: 'INVALID_ENCODING' });
};

describe('decodeText', () => {
  it('decodes plain UTF-8 including multi-byte characters', () => {
    expect(decodeText(Buffer.from('name,città\n€,😀', 'utf8'))).toBe(
      'name,città\n€,😀',
    );
  });

  it('strips a UTF-8 byte order mark', () => {
    expect(
      decodeText(Buffer.concat([BOM, Buffer.from('{"a":1}', 'utf8')])),
    ).toBe('{"a":1}');
  });

  // TextDecoder already drops the first BOM; stripByteOrderMark then drops a
  // second one, so a doubled BOM is removed entirely.
  it('removes a doubled BOM', () => {
    expect(
      decodeText(Buffer.concat([BOM, BOM, Buffer.from('x', 'utf8')])),
    ).toBe('x');
    expect(decodeHead(Buffer.concat([BOM, BOM, Buffer.from(' x')]))).toBe('x');
  });

  it('keeps a BOM-like character that is not at the start', () => {
    expect(decodeText(Buffer.from('a﻿b', 'utf8'))).toBe('a﻿b');
  });

  it('decodes UTF-16 LE and BE inputs announced by their BOM', () => {
    const le = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('a,ü', 'utf16le'),
    ]);
    const be = Buffer.from([0xfe, 0xff, 0x00, 0x61, 0x00, 0xfc]);

    expect(decodeText(le)).toBe('a,ü');
    expect(decodeText(be)).toBe('aü');
  });

  it('decodes an empty buffer to an empty string', () => {
    expect(decodeText(Buffer.alloc(0))).toBe('');
  });

  it.each([
    ['a lone continuation byte', [0x61, 0x80, 0x62]],
    ['a truncated multi-byte sequence', [0x61, 0xe2, 0x82]],
    ['an overlong encoding', [0xc0, 0xaf]],
    ['a Latin-1 byte', [0x63, 0x61, 0x66, 0xe9]],
  ])('rejects %s with INVALID_ENCODING', (_label, bytes) => {
    expect(() => decodeText(Buffer.from(bytes))).toThrow(
      expect.objectContaining({
        code: 'INVALID_ENCODING',
        message: 'File is not valid UTF-8 text',
      }) as Error,
    );
  });
});

describe('decodeHead', () => {
  it('strips the BOM and leading whitespace', () => {
    expect(
      decodeHead(Buffer.concat([BOM, Buffer.from(' \r\n\t<root/>', 'utf8')])),
    ).toBe('<root/>');
  });

  it('is lenient about invalid or truncated sequences', () => {
    expect(decodeHead(Buffer.from([0x7b, 0x22, 0xe2, 0x82]))).toBe('{"�');
  });

  it('honours a UTF-16 BOM', () => {
    const le = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('  [1]', 'utf16le'),
    ]);

    expect(decodeHead(le)).toBe('[1]');
  });
});

describe('decodeTextStream', () => {
  const text = 'id,name\n1,Zoë 😀\n2,€uro — ok\n';
  const bytes = Buffer.from(text, 'utf8');

  it.each([1, 2, 3, 5, 7, bytes.length])(
    'reassembles multi-byte characters split across %i-byte chunks',
    async (size) => {
      const out = await collect(splitEvery(bytes, size));

      expect(out.join('')).toBe(text);
      expect(out.every((chunk) => chunk !== '')).toBe(true);
    },
  );

  it('splits a 4-byte emoji at every possible boundary', async () => {
    const emoji = Buffer.from('😀', 'utf8');

    for (let cut = 1; cut < emoji.length; cut++) {
      const out = await collect([
        Buffer.from('a'),
        emoji.subarray(0, cut),
        emoji.subarray(cut),
        Buffer.from('b'),
      ]);

      expect(out.join('')).toBe('a😀b');
    }
  });

  it.each([1, 2, 3, 4])(
    'strips a UTF-8 BOM even when split into %i-byte chunks',
    async (size) => {
      const out = await collect(
        splitEvery(Buffer.concat([BOM, Buffer.from('[1]', 'utf8')]), size),
      );

      expect(out.join('')).toBe('[1]');
    },
  );

  it('removes a doubled BOM at the start of the stream', async () => {
    const out = await collect([BOM, BOM, Buffer.from('x')]);

    expect(out.join('')).toBe('x');
  });

  it('strips the BOM only once, at the start of the stream', async () => {
    const out = await collect([
      BOM,
      Buffer.from('a', 'utf8'),
      Buffer.from('﻿b', 'utf8'),
    ]);

    expect(out.join('')).toBe('a﻿b');
  });

  it('decodes a UTF-16 LE stream whose BOM arrives one byte at a time', async () => {
    const le = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('x,ÿ\n', 'utf16le'),
    ]);

    expect((await collect(splitEvery(le, 1))).join('')).toBe('x,ÿ\n');
  });

  it('yields nothing for an empty source or empty chunks', async () => {
    expect(await collect([])).toEqual([]);
    expect(await collect([Buffer.alloc(0), Buffer.alloc(0)])).toEqual([]);
  });

  it('decodes a single-byte source shorter than the detection window', async () => {
    expect(await collect([Buffer.from('x')])).toEqual(['x']);
  });

  it('decodes a source that is only a UTF-8 BOM to nothing', async () => {
    expect(await collect([BOM])).toEqual([]);
  });

  it('rejects an invalid byte in the middle of the stream', async () => {
    await expectEncodingError(
      collect([
        Buffer.from('abc'),
        Buffer.from([0x61, 0xff]),
        Buffer.from('z'),
      ]),
    );
  });

  it('rejects an invalid byte in the first chunk', async () => {
    await expectEncodingError(collect([Buffer.from([0x80, 0x80])]));
  });

  it('rejects a multi-byte sequence truncated at the end of the stream', async () => {
    await expectEncodingError(
      collect([Buffer.from('ab'), Buffer.from([0xf0, 0x9f, 0x98])]),
    );
  });

  it('rejects a lone invalid byte that never fills the detection window', async () => {
    await expectEncodingError(collect([Buffer.from([0xc3])]));
  });
});
