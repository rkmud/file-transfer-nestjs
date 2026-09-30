import * as yaml from 'yaml';
import { FormatMatch, ParseLimits } from './format.types';
import { YamlFormatHandler } from './yaml.format';

jest.mock('yaml', () => {
  const actual = jest.requireActual<typeof import('yaml')>('yaml');

  return { ...actual, parseAllDocuments: jest.fn(actual.parseAllDocuments) };
});

const parseAllDocuments = jest.mocked(yaml.parseAllDocuments);

const LIMITS: ParseLimits = { maxDepth: 32, maxNodes: 1000, maxYamlAliases: 5 };

describe('YamlFormatHandler', () => {
  const handler = new YamlFormatHandler();

  it('declares its format metadata', () => {
    expect(handler.format).toBe('yaml');
    expect(handler.extensions).toEqual(['.yaml', '.yml']);
    expect(handler.mimeType).toBe('application/yaml');
    expect(handler.canStream).toBeUndefined();
    expect(handler.readRecords).toBeUndefined();
  });

  describe('sniff', () => {
    it.each([
      ['---\na: 1', FormatMatch.Certain],
      ['%YAML 1.2\n---', FormatMatch.Certain],
      ['- a\n- b', FormatMatch.Likely],
      ['name: Zoë\nage: 3', FormatMatch.Likely],
      ['key:', FormatMatch.Likely],
      ['a,b: c', FormatMatch.Possible],
      ['"quoted": 1', FormatMatch.Possible],
      ['# comment', FormatMatch.Possible],
      ['plain scalar', FormatMatch.Possible],
      ['http://x', FormatMatch.Possible],
      ['<root/>', FormatMatch.No],
    ])('%j -> %s', (head, expected) => {
      expect(handler.sniff(head)).toBe(expected);
    });
  });

  describe('parse', () => {
    it('parses a mapping using YAML 1.2 core schema', () => {
      expect(
        handler.parse(
          'name: Zoë\nage: 3\nyes: no\nlist:\n  - 1\n  - two\nnested: {a: null}\n',
          LIMITS,
        ),
      ).toEqual({
        name: 'Zoë',
        age: 3,
        yes: 'no',
        list: [1, 'two'],
        nested: { a: null },
      });
    });

    it('returns an array for a multi-document stream', () => {
      expect(handler.parse('---\na: 1\n---\nb: 2\n', LIMITS)).toEqual([
        { a: 1 },
        { b: 2 },
      ]);
    });

    it.each(['', '# only a comment\n'])(
      'returns null for an empty stream (%j)',
      (text) => {
        expect(handler.parse(text, LIMITS)).toBeNull();
      },
    );

    it('allows aliases within the limit', () => {
      expect(handler.parse('a: &x [1]\nb: *x\nc: *x\n', LIMITS)).toEqual({
        a: [1],
        b: [1],
        c: [1],
      });
    });

    it('rejects alias expansion beyond maxYamlAliases as LIMIT_EXCEEDED', () => {
      const billionLaughs = [
        'a: &a ["lol","lol","lol"]',
        'b: &b [*a,*a,*a,*a,*a]',
        'c: &c [*b,*b,*b,*b,*b]',
        'd: [*c,*c,*c,*c,*c]',
      ].join('\n');

      expect(() => handler.parse(billionLaughs, LIMITS)).toThrow(
        expect.objectContaining({
          code: 'LIMIT_EXCEEDED',
          message: 'YAML alias expansion exceeds the allowed limit',
        }) as Error,
      );
    });

    it.each([
      ['a duplicate key', 'a: 1\na: 2\n', 'DUPLICATE_KEY'],
      ['bad indentation', 'a: [1\n', 'BAD_INDENT'],
    ])('rejects %s as SYNTAX_ERROR', (_l, text, code) => {
      expect(() => handler.parse(text, LIMITS)).toThrow(
        expect.objectContaining({
          code: 'SYNTAX_ERROR',
          message: expect.stringContaining(
            `Invalid YAML syntax (${code}`,
          ) as string,
        }) as Error,
      );
    });

    // Divergence: an alias to an undefined anchor makes toJS() throw a
    // ReferenceError, which is reported as the alias-limit LIMIT_EXCEEDED rather
    // than SYNTAX_ERROR.
    it('reports an unresolved alias as LIMIT_EXCEEDED', () => {
      expect(() => handler.parse('a: *missing\n', LIMITS)).toThrow(
        expect.objectContaining({
          code: 'LIMIT_EXCEEDED',
          message: 'YAML alias expansion exceeds the allowed limit',
        }) as Error,
      );
    });

    it('rejects a syntax error in a later document', () => {
      expect(() => handler.parse('a: 1\n---\nb: 1\nb: 2\n', LIMITS)).toThrow(
        expect.objectContaining({ code: 'SYNTAX_ERROR' }) as Error,
      );
    });
  });

  describe('serialize', () => {
    it('writes block YAML without line wrapping or anchors', () => {
      const shared = { k: 'v' };
      const long = 'word '.repeat(40).trim();

      expect(handler.serialize({ a: shared, b: shared, long })).toBe(
        `a:\n  k: v\nb:\n  k: v\nlong: ${long}\n`,
      );
    });

    it('writes null for undefined', () => {
      expect(handler.serialize(undefined)).toBe('null\n');
    });
  });

  it('round-trips parse(serialize(data))', () => {
    const data = {
      text: 'line1\nline2',
      quoted: 'yes',
      num: '42',
      list: [1, null, true, { deep: ['x'] }],
      emoji: '😀',
    };
    const text = handler.serialize(data);

    expect(handler.parse(text, LIMITS)).toEqual(data);
    expect(handler.sniff(text)).toBe(FormatMatch.Likely);
  });

  describe('createWriter', () => {
    it('writes each record as a sequence entry', () => {
      const writer = handler.createWriter();

      expect(writer.needsScan).toBeUndefined();
      expect(writer.write({ a: 1, b: 'x' })).toBe('- a: 1\n  b: x\n');
      expect(writer.write(undefined)).toBe('- null\n');
      expect(writer.end()).toBe('');
    });

    it('writes an empty sequence when no record was written', () => {
      expect(handler.createWriter().end()).toBe('[]\n');
    });
  });

  describe('defensive branches (library contract edge cases)', () => {
    const fakeDocument = (overrides: object): yaml.Document.Parsed =>
      ({ errors: [], toJS: () => null, ...overrides }) as never;

    it('returns null when the library returns no document list', () => {
      parseAllDocuments.mockReturnValueOnce(null as never);

      expect(handler.parse('a: 1', LIMITS)).toBeNull();
    });

    it('includes the line number when the error carries a position', () => {
      parseAllDocuments.mockReturnValueOnce([
        fakeDocument({
          errors: [{ code: 'BAD_INDENT', linePos: [{ line: 4, col: 1 }] }],
        }),
      ] as never);

      expect(() => handler.parse('x', LIMITS)).toThrow(
        'Invalid YAML syntax (BAD_INDENT) at line 4',
      );
    });

    it('rethrows unexpected errors from toJS()', () => {
      const failure = new TypeError('boom');

      parseAllDocuments.mockReturnValueOnce([
        fakeDocument({
          toJS: () => {
            throw failure;
          },
        }),
      ] as never);

      expect(() => handler.parse('x', LIMITS)).toThrow(failure);
    });
  });
});
