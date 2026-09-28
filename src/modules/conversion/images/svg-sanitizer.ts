import {
  XMLBuilder,
  XMLParser,
  XMLValidator,
  X2jOptions,
} from 'fast-xml-parser';
import { ImageConversionError } from './image-conversion-error';
import { Dimensions } from './image-format.types';
import { resolveIntrinsicSize } from './svg-geometry';

type SvgNode = Record<string, unknown>;
type SvgAttributes = Record<string, string>;

const ATTRIBUTES_KEY = ':@';
const ATTRIBUTE_PREFIX = '@_';
const TEXT_KEY = '#text';
const CDATA_KEY = '#cdata';

const XML_OPTIONS: Partial<X2jOptions> = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  textNodeName: TEXT_KEY,
  cdataPropName: CDATA_KEY,
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  allowBooleanAttributes: true,
};

const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'audio',
  'video',
  'handler',
  'listener',
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  'animatecolor',
  'discard',
  'meta',
  'link',
  'base',
]);

const REFERENCE_ATTRIBUTES = new Set(['href', 'src']);
const FORBIDDEN_ATTRIBUTES = new Set(['xml:base']);

const SAFE_DATA_URI = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i;
const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const CSS_IMPORT = /@import\b[^;]*;?/gi;
const PREDEFINED_ENTITY = /^(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+)$/i;
const ENTITY_REFERENCE = /&([^;\s&]+);/g;
const DOCTYPE = /<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>/gi;

export interface SanitizedSvg {
  intrinsicSize: Dimensions | null;
  render(size: Dimensions): string;
}

const localName = (name: string): string =>
  name.slice(name.indexOf(':') + 1).toLowerCase();

const isSafeReference = (value: string): boolean => {
  const target = value.trim();

  return target.startsWith('#') || SAFE_DATA_URI.test(target);
};

const hasExternalUrl = (value: string): boolean =>
  [...value.matchAll(CSS_URL)].some(([, , target]) => !isSafeReference(target));

const stripCustomEntities = (value: string): string =>
  value.replace(ENTITY_REFERENCE, (reference, name: string) =>
    PREDEFINED_ENTITY.test(name) ? reference : '',
  );

const sanitizeCss = (css: string): string => {
  if (css.includes('\\')) return '';

  return css
    .replace(CSS_IMPORT, '')
    .replace(CSS_URL, (match, _quote, target: string) =>
      isSafeReference(target) ? match : 'none',
    );
};

const sanitizeAttributes = (attributes: SvgAttributes): SvgAttributes => {
  const result: SvgAttributes = {};

  for (const [key, raw] of Object.entries(attributes)) {
    const name = key.slice(ATTRIBUTE_PREFIX.length);
    const local = localName(name);
    const value = stripCustomEntities(String(raw));

    if (
      local.startsWith('on') ||
      FORBIDDEN_ATTRIBUTES.has(name.toLowerCase())
    ) {
      continue;
    }

    if (REFERENCE_ATTRIBUTES.has(local) && !isSafeReference(value)) {
      continue;
    }

    if (local === 'style') {
      const css = sanitizeCss(value);

      if (css !== '') result[key] = css;
      continue;
    }

    if (hasExternalUrl(value)) {
      continue;
    }

    result[key] = value;
  }

  return result;
};

const elementName = (node: SvgNode): string | undefined =>
  Object.keys(node).find((key) => key !== ATTRIBUTES_KEY);

const sanitizeNodes = (nodes: SvgNode[], parent: string): SvgNode[] => {
  const result: SvgNode[] = [];

  for (const node of nodes) {
    const name = elementName(node);

    if (name === undefined) continue;

    if (name === TEXT_KEY) {
      const text = stripCustomEntities(String(node[TEXT_KEY]));

      result.push({
        [TEXT_KEY]: parent === 'style' ? sanitizeCss(text) : text,
      });
      continue;
    }

    if (name === CDATA_KEY) {
      const children = sanitizeNodes(node[CDATA_KEY] as SvgNode[], parent);

      result.push({ [CDATA_KEY]: children });
      continue;
    }

    if (name.startsWith('#') || name.startsWith('?') || name.startsWith('!')) {
      continue;
    }

    const local = localName(name);

    if (FORBIDDEN_ELEMENTS.has(local)) continue;

    const sanitized: SvgNode = {
      [name]: sanitizeNodes((node[name] as SvgNode[]) ?? [], local),
    };
    const attributes = node[ATTRIBUTES_KEY] as SvgAttributes | undefined;

    if (attributes) {
      sanitized[ATTRIBUTES_KEY] = sanitizeAttributes(attributes);
    }

    result.push(sanitized);
  }

  return result;
};

const fail = (message: string): never => {
  throw new ImageConversionError('SVG_SANITY_FAILED', message);
};

export const sanitizeSvg = (input: string): SanitizedSvg => {
  const markup = input.replace(DOCTYPE, '');

  if (
    XMLValidator.validate(markup, { allowBooleanAttributes: true }) !== true
  ) {
    fail('SVG markup is not well-formed XML');
  }

  let parsed: SvgNode[] = [];

  try {
    parsed = new XMLParser(XML_OPTIONS).parse(markup) as SvgNode[];
  } catch {
    fail('SVG markup could not be parsed');
  }

  const nodes = sanitizeNodes(parsed, '');
  const elements = nodes.filter((node) => {
    const name = elementName(node);

    return name !== undefined && name !== TEXT_KEY && name !== CDATA_KEY;
  });

  if (elements.length !== 1) {
    fail('SVG document must have a single root element');
  }

  const [root] = elements;
  const rootName = elementName(root)!;

  if (localName(rootName) !== 'svg') {
    fail('Root element must be <svg>');
  }

  const attributes = (root[ATTRIBUTES_KEY] ?? {}) as SvgAttributes;
  const attribute = (name: string): string | undefined =>
    attributes[`${ATTRIBUTE_PREFIX}${name}`];

  const intrinsicSize = resolveIntrinsicSize(
    attribute('width'),
    attribute('height'),
    attribute('viewBox'),
  );

  const builder = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: ATTRIBUTE_PREFIX,
    textNodeName: TEXT_KEY,
    cdataPropName: CDATA_KEY,
    processEntities: false,
    suppressEmptyNode: true,
  });

  return {
    intrinsicSize,
    render: ({ width, height }) => {
      const sized: SvgAttributes = {
        ...attributes,
        [`${ATTRIBUTE_PREFIX}width`]: String(width),
        [`${ATTRIBUTE_PREFIX}height`]: String(height),
      };

      if (attribute('viewBox') === undefined && intrinsicSize) {
        sized[`${ATTRIBUTE_PREFIX}viewBox`] =
          `0 0 ${intrinsicSize.width} ${intrinsicSize.height}`;
      }

      return builder.build([
        { [rootName]: root[rootName], [ATTRIBUTES_KEY]: sized },
      ]) as string;
    },
  };
};
