import { FormatMatch, ParseLimits } from './format.types';
import { assertStructureLimits } from './structure';
import { XmlFormatHandler } from './xml.format';

const LIMITS: ParseLimits = {
  maxDepth: 32,
  maxNodes: 1000,
  maxYamlAliases: 10,
};

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

describe('XmlFormatHandler', () => {
  const handler = new XmlFormatHandler();

  it('declares its format metadata', () => {
    expect(handler.format).toBe('xml');
    expect(handler.extensions).toEqual(['.xml']);
    expect(handler.mimeType).toBe('application/xml');
    expect(handler.canStream).toBeUndefined();
    expect(handler.readRecords).toBeUndefined();
  });

  describe('sniff', () => {
    it.each([
      ['<?xml version="1.0"?><a/>', FormatMatch.Certain],
      ['<root></root>', FormatMatch.Certain],
      ['{"a":1}', FormatMatch.No],
      ['a,b', FormatMatch.No],
      ['', FormatMatch.No],
    ])('%j -> %s', (head, expected) => {
      expect(handler.sniff(head)).toBe(expected);
    });
  });

  describe('parse', () => {
    it('maps attributes to @-prefixed keys and repeated elements to arrays', () => {
      expect(
        handler.parse(
          `${DECLARATION}<?pi ignored?><users><user id="1" active="true"><name>Zoë</name></user>` +
            '<user id="2"><name>  Bob  </name><tag>a</tag><tag>b</tag></user></users>',
          LIMITS,
        ),
      ).toEqual({
        users: {
          user: [
            { '@id': '1', '@active': 'true', name: 'Zoë' },
            { '@id': '2', name: 'Bob', tag: ['a', 'b'] },
          ],
        },
      });
    });

    it('keeps text next to attributes under #text and values as strings', () => {
      expect(handler.parse('<n unit="kg">42</n>', LIMITS)).toEqual({
        n: { '@unit': 'kg', '#text': '42' },
      });
    });

    it.each([
      [
        'an external entity (XXE)',
        '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>',
      ],
      [
        'a billion-laughs entity expansion',
        '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><lolz>&lol2;</lolz>',
      ],
      ['a bare DOCTYPE', '<!DOCTYPE html><html/>'],
      ['a lowercase doctype with spacing', '<! doctype r><r/>'],
      ['a standalone ENTITY declaration', '<r><!ENTITY x "y"></r>'],
    ])('rejects %s as FORBIDDEN_CONSTRUCT', (_l, text) => {
      expect(() => handler.parse(text, LIMITS)).toThrow(
        expect.objectContaining({
          code: 'FORBIDDEN_CONSTRUCT',
          message: 'DTD and entity declarations are not allowed in XML',
        }) as Error,
      );
    });

    it.each([
      ['a mismatched closing tag', '<a><b></a>', 1],
      ['an unclosed element', '<a>\n<b>\n</b>', 1],
      ['text outside any element', 'just text', 1],
    ])('rejects %s as SYNTAX_ERROR with its line', (_l, text, line) => {
      expect(() => handler.parse(text, LIMITS)).toThrow(
        expect.objectContaining({
          code: 'SYNTAX_ERROR',
          message: expect.stringMatching(
            new RegExp(`^Invalid XML syntax at line ${line}: `),
          ) as string,
        }) as Error,
      );
    });

    // Divergence: nesting is capped by the parser's maxNestedTags, which lets
    // maxDepth + 1 element levels through (then caught by assertStructureLimits
    // as LIMIT_EXCEEDED) and rejects deeper documents as SYNTAX_ERROR, not
    // LIMIT_EXCEEDED.
    it('rejects nesting beyond maxDepth + 1 levels (reported as SYNTAX_ERROR)', () => {
      const limits = { ...LIMITS, maxDepth: 3 };

      expect(() =>
        handler.parse('<a><b><c><d><e>x</e></d></c></b></a>', limits),
      ).toThrow(
        expect.objectContaining({
          code: 'SYNTAX_ERROR',
          message: 'Invalid XML: Maximum nested tags exceeded',
        }) as Error,
      );

      const fourLevels = handler.parse('<a><b><c><d>x</d></c></b></a>', limits);

      expect(fourLevels).toEqual({ a: { b: { c: { d: 'x' } } } });
      expect(() => assertStructureLimits(fourLevels, limits)).toThrow(
        expect.objectContaining({ code: 'LIMIT_EXCEEDED' }) as Error,
      );
    });

    it('leaves node-count limits to assertStructureLimits', () => {
      const data = handler.parse(`<r>${'<i>x</i>'.repeat(20)}</r>`, LIMITS);

      expect(() =>
        assertStructureLimits(data, { maxDepth: 10, maxNodes: 10 }),
      ).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }) as Error);
    });
  });

  describe('serialize', () => {
    it('wraps the document in a single <root> element with a declaration', () => {
      expect(handler.serialize({ name: 'Zoë', age: 3 })).toBe(
        `${DECLARATION}<root>\n  <name>Zoë</name>\n  <age>3</age>\n</root>\n`,
      );
    });

    it('writes arrays as repeated <item> elements', () => {
      expect(handler.serialize([1, 'a'])).toBe(
        `${DECLARATION}<root>\n  <item>1</item>\n  <item>a</item>\n</root>\n`,
      );
    });

    it('writes array properties as repeated elements', () => {
      expect(handler.serialize({ tag: ['a', 'b'] })).toBe(
        `${DECLARATION}<root>\n  <tag>a</tag>\n  <tag>b</tag>\n</root>\n`,
      );
    });

    it('writes @-keys as attributes and #text as text content', () => {
      expect(
        handler.serialize({
          n: { '@unit': 'kg', '@9bad key': 'x', '#text': 5 },
        }),
      ).toBe(
        `${DECLARATION}<root>\n  <n unit="kg" _9bad_key="x">5</n>\n</root>\n`,
      );
    });

    it('treats a lone "@" key as an element name', () => {
      expect(handler.serialize({ '@': 'v' })).toBe(
        `${DECLARATION}<root>\n  <_>v</_>\n</root>\n`,
      );
    });

    it('sanitizes invalid element names and de-duplicates collisions', () => {
      expect(
        handler.serialize({
          'first name': 1,
          first_name: 2,
          'first-name?': 3,
          '1st': 4,
          ünï: 5,
        }),
      ).toBe(
        `${DECLARATION}<root>\n` +
          '  <first_name>1</first_name>\n' +
          '  <first_name_2>2</first_name_2>\n' +
          '  <first-name_>3</first-name_>\n' +
          '  <_1st>4</_1st>\n' +
          '  <ünï>5</ünï>\n' +
          '</root>\n',
      );
    });

    it('escapes markup, strips invalid XML characters and JSON-encodes nested values in text', () => {
      expect(
        handler.serialize({
          t: 'a < b & "c"\u0001\u000b',
          n: null,
          u: undefined,
          at: { '@x': { y: 1 } },
        }),
      ).toBe(
        `${DECLARATION}<root>\n` +
          '  <t>a &lt; b &amp; &quot;c&quot;</t>\n' +
          '  <n></n>\n' +
          '  <u></u>\n' +
          '  <at x="{&quot;y&quot;:1}"></at>\n' +
          '</root>\n',
      );
    });

    it('does not re-indent text nodes that contain newlines', () => {
      const output = handler.serialize({ note: 'line1\nline2\n  indented' });

      expect(output).toContain('<note>line1\nline2\n  indented</note>');
    });

    it('writes an empty root for an empty array', () => {
      expect(handler.serialize([])).toBe(`${DECLARATION}<root></root>\n`);
    });
  });

  it('round-trips parse(serialize(data)) for string-valued data', () => {
    const data = {
      users: {
        user: [
          { '@id': '1', name: 'Zoë', note: 'multi\nline' },
          { '@id': '2', name: 'Bob & <Co>' },
        ],
      },
    };
    const text = handler.serialize(data);

    expect(handler.sniff(text)).toBe(FormatMatch.Certain);
    expect(handler.parse(text, LIMITS)).toEqual({ root: data });
  });

  describe('createWriter', () => {
    it('writes the declaration and root once, then one <item> per record', () => {
      const writer = handler.createWriter();

      expect(writer.needsScan).toBeUndefined();
      expect(writer.write({ a: 1 })).toBe(
        `${DECLARATION}<root>\n  <item>\n    <a>1</a>\n  </item>\n`,
      );
      expect(writer.write('x')).toBe('  <item>x</item>\n');
      expect(writer.end()).toBe('</root>\n');
    });

    it('writes an empty root when no record was written', () => {
      expect(handler.createWriter().end()).toBe(
        `${DECLARATION}<root></root>\n`,
      );
    });
  });
});
