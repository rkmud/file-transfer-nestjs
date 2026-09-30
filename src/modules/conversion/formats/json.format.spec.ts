import { ConversionError } from './conversion-error';
import { FormatMatch } from './format.types';
import { JsonFormatHandler } from './json.format';

async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

describe('JsonFormatHandler', () => {
  const handler = new JsonFormatHandler();

  it('declares its format metadata', () => {
    expect(handler.format).toBe('json');
    expect(handler.extensions).toEqual(['.json']);
    expect(handler.mimeType).toBe('application/json');
  });

  describe('sniff', () => {
    it.each([
      ['{"a":1}', FormatMatch.Certain],
      ['[1,2]', FormatMatch.Certain],
      ['"text"', FormatMatch.Possible],
      ['-12.5', FormatMatch.Possible],
      ['42', FormatMatch.Possible],
      ['true', FormatMatch.Possible],
      ['false', FormatMatch.Possible],
      ['null', FormatMatch.Possible],
      ['nullable: yes', FormatMatch.No],
      ['a,b', FormatMatch.No],
      ['<root/>', FormatMatch.No],
      ['', FormatMatch.No],
    ])('%j -> %s', (head, expected) => {
      expect(handler.sniff(head)).toBe(expected);
    });
  });

  describe('parse', () => {
    it('parses any JSON value', () => {
      expect(handler.parse('{"a":[1,{"b":null}],"c":"é"}')).toEqual({
        a: [1, { b: null }],
        c: 'é',
      });
      expect(handler.parse('"x"')).toBe('x');
      expect(handler.parse('null')).toBeNull();
    });

    it('reports a syntax error with its position when the engine provides one', () => {
      expect(() => handler.parse('[1 2]')).toThrow(
        expect.objectContaining({
          code: 'SYNTAX_ERROR',
          message: 'Invalid JSON syntax at position 3',
        }) as Error,
      );
    });

    it.each(['{"a":', '', '{"a":}'])('reports %j as SYNTAX_ERROR', (text) => {
      expect(() => handler.parse(text)).toThrow(ConversionError);
      expect(() => handler.parse(text)).toThrow(
        expect.objectContaining({
          code: 'SYNTAX_ERROR',
          message: expect.stringMatching(/^Invalid JSON syntax/) as string,
        }) as Error,
      );
    });
  });

  describe('serialize', () => {
    it('pretty-prints with two spaces and a trailing newline', () => {
      expect(handler.serialize({ a: [1, 'x'] })).toBe(
        '{\n  "a": [\n    1,\n    "x"\n  ]\n}\n',
      );
    });

    it('writes null for undefined', () => {
      expect(handler.serialize(undefined)).toBe('null\n');
    });
  });

  it('round-trips parse(serialize(data))', () => {
    const data = { list: [1, 2.5, true, null], text: 'line\n"q" 😀', o: {} };
    const text = handler.serialize(data);

    expect(handler.parse(text)).toEqual(data);
    expect(handler.sniff(text)).toBe(FormatMatch.Certain);
  });

  describe('streaming', () => {
    it('streams only documents whose top level is an array', () => {
      expect(handler.canStream('[{"a":1}]')).toBe(true);
      expect(handler.canStream('{"items":[]}')).toBe(false);
      expect(handler.canStream('"x"')).toBe(false);
    });

    it('reads records from a top-level array', async () => {
      const records: unknown[] = [];

      for await (const record of handler.readRecords(
        fromChunks(['[{"a"', ':1},', '2,"x"]']),
      )) {
        records.push(record);
      }

      expect(records).toEqual([{ a: 1 }, 2, 'x']);
    });

    it('writes records as a pretty-printed array', () => {
      const writer = handler.createWriter();

      expect(writer.needsScan).toBeUndefined();
      expect(writer.write({ a: 1 })).toBe('[\n  {\n    "a": 1\n  }');
      expect(writer.write(undefined)).toBe(',\n  null');
      expect(writer.end()).toBe('\n]\n');
    });

    it('writes an empty array when no record was written', () => {
      expect(handler.createWriter().end()).toBe('[]\n');
    });
  });
});
