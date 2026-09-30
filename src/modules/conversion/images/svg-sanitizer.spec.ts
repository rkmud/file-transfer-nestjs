import { ImageConversionError } from './image-conversion-error';
import { sanitizeSvg } from './svg-sanitizer';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo=';

const svg = (body: string, attributes = 'width="10" height="10"'): string =>
  `<svg ${NS} ${XLINK} ${attributes}>${body}</svg>`;

/** Sanitized markup rendered at the intrinsic (or a fixed) size. */
const clean = (input: string): string => {
  const result = sanitizeSvg(input);

  return result.render(result.intrinsicSize ?? { width: 10, height: 10 });
};

const sanityError = (input: string): ImageConversionError => {
  try {
    sanitizeSvg(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ImageConversionError);
    expect((error as ImageConversionError).code).toBe('SVG_SANITY_FAILED');
    return error as ImageConversionError;
  }
  throw new Error('expected SVG_SANITY_FAILED');
};

describe('sanitizeSvg', () => {
  it('keeps safe content untouched', () => {
    const output = clean(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>' +
          '<rect width="10" height="10" fill="url(#g)" opacity="0.5"/>' +
          '<text x="1" y="5">a &amp; b &lt; c &#169; &#xA9;</text>',
      ),
    );

    expect(output).toContain('<linearGradient id="g">');
    expect(output).toContain('fill="url(#g)"');
    expect(output).toContain('opacity="0.5"');
    expect(output).toContain('offset="0"');
    expect(output).toContain('a &amp; b &lt; c &#169; &#xA9;');
  });

  describe('DOCTYPE and entities', () => {
    it('strips an internal DTD with an external (XXE) entity and its references', () => {
      const output = clean(
        '<?xml version="1.0"?>' +
          '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
          svg('<text title="&xxe;">&xxe;</text>'),
      );

      expect(output).not.toMatch(/DOCTYPE|ENTITY|xxe|passwd|<\?xml/i);
      expect(output).toContain('<text title=""/>');
    });

    it('strips a billion-laughs style entity expansion', () => {
      const output = clean(
        '<!DOCTYPE svg [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;">]>' +
          svg('<text>&b;&b;</text>'),
      );

      expect(output).not.toMatch(/ENTITY|&a;|&b;|lol/);
    });

    it('strips an external DOCTYPE without an internal subset', () => {
      const output = clean(
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' +
          svg('<rect/>'),
      );

      expect(output).not.toMatch(/DOCTYPE|w3\.org\/Graphics/);
    });
  });

  describe('active content', () => {
    it('removes <script> elements, including CDATA payloads', () => {
      const output = clean(
        svg(
          '<script>alert(1)</script><script type="text/javascript"><![CDATA[alert(2)]]></script><rect/>',
        ),
      );

      expect(output).not.toMatch(/script|alert/i);
      expect(output).toContain('<rect');
    });

    it('removes inline on* event handlers', () => {
      const output = clean(
        svg(
          '<rect onclick="alert(1)" onmouseover="alert(2)" width="1"/>',
          'width="10" height="10" onload="alert(3)"',
        ),
      );

      expect(output).not.toMatch(/on(click|mouseover|load)|alert/i);
      expect(output).toContain('width="1"');
    });

    it.each(['animate', 'set', 'animateMotion', 'animateTransform', 'discard'])(
      'removes the <%s> animation element',
      (tag) => {
        const output = clean(
          svg(
            `<a href="#x"><${tag} attributeName="href" to="javascript:alert(1)"/>x</a>`,
          ),
        );

        expect(output).not.toMatch(new RegExp(`<${tag}|javascript`, 'i'));
      },
    );

    it('removes <foreignObject> with embedded HTML', () => {
      const output = clean(
        svg(
          '<foreignObject width="10" height="10"><iframe src="http://evil.test"/></foreignObject><circle r="1"/>',
        ),
      );

      expect(output).not.toMatch(/foreignObject|iframe|evil/i);
      expect(output).toContain('<circle r="1"');
    });

    it.each(['iframe', 'object', 'embed', 'audio', 'video', 'link', 'meta'])(
      'removes the embedding element <%s>',
      (tag) => {
        expect(
          clean(svg(`<${tag} src="http://evil.test/x"></${tag}><rect/>`)),
        ).not.toMatch(new RegExp(`<${tag}|evil`, 'i'));
      },
    );
  });

  describe('references', () => {
    it('keeps fragment and data:image references', () => {
      const output = clean(
        svg(
          `<use href="#shape"/><use xlink:href=" #shape"/><image href="${PNG_DATA}"/>`,
        ),
      );

      expect(output).toContain('href="#shape"');
      expect(output).toContain('xlink:href=" #shape"');
      expect(output).toContain(`href="${PNG_DATA}"`);
    });

    it.each([
      'http://evil.test/a.png',
      'https://evil.test/a.svg#x',
      '//evil.test/a.png',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'a.png',
    ])('drops an external href/src %j', (target) => {
      const output = clean(
        svg(
          `<image href="${target}"/><use xlink:href="${target}"/><image src="${target}"/>`,
        ),
      );

      expect(output).not.toContain(target);
      expect(output).not.toMatch(/href=|src=/);
    });

    it('drops xml:base', () => {
      expect(clean(svg('<g xml:base="http://evil.test/"/>'))).not.toContain(
        'xml:base',
      );
    });

    it('drops presentation attributes that reference an external url()', () => {
      const output = clean(
        svg(
          '<rect fill="url(http://evil.test/p.svg#g)" stroke="url( \'https://evil.test/x\' )" filter="url(#f)"/>',
        ),
      );

      expect(output).not.toMatch(/fill=|stroke=|evil/);
      expect(output).toContain('filter="url(#f)"');
    });

    it('neutralises external url() and @import in style attributes', () => {
      const output = clean(
        svg(
          '<rect style="fill:url(&quot;http://evil.test/x&quot;);stroke:url(#ok);background:url(\'https://evil.test/y\')"/>',
        ),
      );

      expect(output).not.toContain('evil');
      expect(output).toContain('url(#ok)');
    });

    it('sanitizes <style> text and CDATA stylesheets', () => {
      const output = clean(
        svg(
          '<style>@import url(http://evil.test/a.css); rect { fill: url(http://evil.test/p#g) }</style>' +
            '<style><![CDATA[@import "https://evil.test/b.css"; circle { fill: url(#ok) }]]></style>',
        ),
      );

      expect(output).not.toMatch(/@import|evil/);
      expect(output).toContain('fill: none');
      expect(output).toContain('url(#ok)');
    });

    it('drops a style attribute that only held external references', () => {
      expect(
        clean(svg('<rect style="@import url(http://evil.test/a.css);"/>')),
      ).not.toContain('style=');
    });
  });

  describe('bypass attempts', () => {
    it('catches mixed-case and namespaced forbidden elements', () => {
      const output = clean(
        svg(
          '<ScRiPt>alert(1)</ScRiPt><svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(2)</svg:script>' +
            '<FOREIGNOBJECT><div/></FOREIGNOBJECT><AnImAtE attributeName="href"/>',
        ),
      );

      expect(output).not.toMatch(/script|alert|foreignobject|animate/i);
    });

    it('catches mixed-case event handlers and namespaced handlers', () => {
      const output = clean(
        svg('<rect OnClIcK="alert(1)" ev:onload="alert(2)"/>'),
      );

      expect(output).not.toMatch(/alert/);
    });

    it('rejects javascript: in xlink:href regardless of case and whitespace', () => {
      const output = clean(
        svg(
          '<a xlink:href="  JaVaScRiPt:alert(1)"><text>x</text></a><a HREF="javascript:alert(2)"/>',
        ),
      );

      expect(output).not.toMatch(/javascript|alert/i);
    });

    it('rejects entity-encoded javascript: references', () => {
      const output = clean(
        svg(
          '<a href="&#106;avascript:alert(1)"/><a xlink:href="&#x6A;avascript:alert(2)"/><a href="&js;alert(3)"/>',
        ),
      );

      expect(output).not.toMatch(/avascript|alert/);
    });

    it('drops CSS that uses escapes to hide url()/expression', () => {
      const output = clean(
        svg(
          '<rect style="fill:u\\72l(http://evil.test/x)"/><style>rect{fill:\\75rl(http://evil.test/y)}</style>',
        ),
      );

      expect(output).not.toContain('evil');
      expect(output).not.toContain('style=');
    });
  });

  describe('structure', () => {
    it.each([
      ['not XML at all', 'hello'],
      ['unclosed tags', `<svg ${NS}><rect>`],
    ])('fails on %s', (_label, input) => {
      expect(sanityError(input).message).toBe(
        'SVG markup is not well-formed XML',
      );
    });

    it('fails on two root elements', () => {
      expect(sanityError(`<svg ${NS}/><svg ${NS}/>`).message).toBe(
        'SVG document must have a single root element',
      );
    });

    it('fails when the root element is removed by sanitization', () => {
      expect(sanityError('<script>alert(1)</script>').message).toBe(
        'SVG document must have a single root element',
      );
    });

    it('fails when the root is not <svg>', () => {
      expect(sanityError(`<html ${NS}><svg/></html>`).message).toBe(
        'Root element must be <svg>',
      );
    });

    it('accepts a namespaced svg root and comments / processing instructions', () => {
      const result = sanitizeSvg(
        '<?xml version="1.0"?><!-- c --><s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 4 2"><?pi x?><s:rect/></s:svg>',
      );

      expect(result.intrinsicSize).toEqual({ width: 4, height: 2 });
      expect(result.render({ width: 8, height: 4 })).toMatch(
        /^<s:svg [^>]*width="8" height="4"/,
      );
    });
  });

  describe('parser edge cases', () => {
    const withParser = (
      parse: () => unknown,
    ): typeof import('./svg-sanitizer').sanitizeSvg => {
      let isolated!: typeof import('./svg-sanitizer').sanitizeSvg;

      jest.isolateModules(() => {
        jest.doMock('fast-xml-parser', () => ({
          ...jest.requireActual<object>('fast-xml-parser'),
          XMLParser: jest.fn(() => ({ parse })),
        }));
        ({ sanitizeSvg: isolated } =
          jest.requireActual<typeof import('./svg-sanitizer')>(
            './svg-sanitizer',
          ));
      });
      jest.dontMock('fast-xml-parser');

      return isolated;
    };

    it('maps a parser exception to SVG_SANITY_FAILED', () => {
      const isolated = withParser(() => {
        throw new Error('boom');
      });

      expect(() => isolated(svg(''))).toThrow(
        expect.objectContaining({
          code: 'SVG_SANITY_FAILED',
          message: 'SVG markup could not be parsed',
        }),
      );
    });

    it('skips special (#, ?, !) and empty nodes', () => {
      const isolated = withParser(() => [
        { '?xml-stylesheet': [], ':@': { '@_href': 'http://evil.test' } },
        { '!ELEMENT': [] },
        { ':@': {} },
        {
          svg: [
            { '#comment': [{ '#text': 'x' }] },
            { rect: [] },
            { g: undefined },
          ],
          ':@': { '@_width': '2', '@_height': '1' },
        },
      ]);
      const result = isolated('<svg/>');

      expect(result.intrinsicSize).toEqual({ width: 2, height: 1 });
      expect(result.render({ width: 2, height: 1 })).toBe(
        '<svg width="2" height="1" viewBox="0 0 2 1"><rect/><g/></svg>',
      );
    });
  });

  describe('render', () => {
    it('reports the intrinsic size from width/height/viewBox', () => {
      expect(
        sanitizeSvg(svg('', 'width="1in" height="48pt"')).intrinsicSize,
      ).toEqual({ width: 96, height: 64 });
      expect(sanitizeSvg(svg('', '')).intrinsicSize).toBeNull();
    });

    it('rewrites the root size and adds a viewBox from the intrinsic size', () => {
      const output = sanitizeSvg(
        svg('<rect/>', 'width="20" height="10"'),
      ).render({ width: 200, height: 100 });

      expect(output).toContain('width="200"');
      expect(output).toContain('height="100"');
      expect(output).toContain('viewBox="0 0 20 10"');
      expect(output).not.toContain('width="20"');
    });

    it('keeps an existing viewBox', () => {
      const output = sanitizeSvg(
        svg('', 'width="20" height="10" viewBox="5 5 40 20"'),
      ).render({ width: 2, height: 1 });

      expect(output).toContain('viewBox="5 5 40 20"');
      expect(output.match(/viewBox/g)).toHaveLength(1);
    });

    it('handles a root without attributes', () => {
      const result = sanitizeSvg('<svg/>');

      expect(result.intrinsicSize).toBeNull();
      expect(result.render({ width: 3, height: 4 })).toBe(
        '<svg width="3" height="4"/>',
      );
    });

    it('adds no viewBox when there is no intrinsic size', () => {
      const output = sanitizeSvg(svg('<rect/>', '')).render({
        width: 1024,
        height: 1024,
      });

      expect(output).toContain('width="1024"');
      expect(output).not.toContain('viewBox');
    });
  });
});
