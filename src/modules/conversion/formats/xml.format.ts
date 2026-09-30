import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { ConversionError } from './conversion-error';
import { TextFormatHandler } from './format-handler';
import { FormatMatch, ParseLimits } from './format.types';
import { RecordWriter } from './record-stream';
import { isPlainObject, PlainObject } from './structure';

export const XML_ATTRIBUTE_PREFIX = '@';
export const XML_TEXT_KEY = '#text';
export const XML_ROOT_ELEMENT = 'root';
export const XML_ITEM_ELEMENT = 'item';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

const ROOT_OPEN = `<${XML_ROOT_ELEMENT}>\n`;
const ROOT_CLOSE = `</${XML_ROOT_ELEMENT}>\n`;

const DTD_PATTERN = /<!\s*(DOCTYPE|ENTITY)/i;

// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const XML_BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: XML_ATTRIBUTE_PREFIX,
  textNodeName: XML_TEXT_KEY,
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
  processEntities: true,
});

const NAME_START = /^[\p{L}_]/u;
const NAME_INVALID_CHARS = /[^\p{L}\p{N}._:-]/gu;

const toElementName = (key: string): string => {
  const name = key.replace(NAME_INVALID_CHARS, '_');

  return NAME_START.test(name) ? name : `_${name}`;
};

const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);

  return String(value).replace(INVALID_XML_CHARS, '');
};

class XmlRecordWriter implements RecordWriter {
  private wrote = false;

  constructor(private readonly toNode: (value: unknown) => unknown) {}

  write(record: unknown): string {
    const prologue = this.wrote ? '' : `${XML_DECLARATION}${ROOT_OPEN}`;

    this.wrote = true;

    return `${prologue}${this.buildItem(record)}`;
  }

  end(): string {
    return this.wrote
      ? ROOT_CLOSE
      : `${XML_DECLARATION}<${XML_ROOT_ELEMENT}></${XML_ROOT_ELEMENT}>\n`;
  }

  private buildItem(record: unknown): string {
    const document = XML_BUILDER.build({
      [XML_ROOT_ELEMENT]: { [XML_ITEM_ELEMENT]: this.toNode(record) },
    }) as string;

    return document.slice(
      ROOT_OPEN.length,
      document.length - ROOT_CLOSE.length,
    );
  }
}

export class XmlFormatHandler extends TextFormatHandler {
  readonly format = 'xml';
  readonly extensions = ['.xml'];
  readonly mimeType = 'application/xml';

  sniff(head: string): FormatMatch {
    return head.startsWith('<') ? FormatMatch.Certain : FormatMatch.No;
  }

  parse(text: string, { maxDepth }: ParseLimits): unknown {
    if (DTD_PATTERN.test(text)) {
      throw new ConversionError(
        'FORBIDDEN_CONSTRUCT',
        'DTD and entity declarations are not allowed in XML',
      );
    }

    const validation = XMLValidator.validate(text);

    if (validation !== true) {
      const { msg, line } = validation.err;

      throw new ConversionError(
        'SYNTAX_ERROR',
        `Invalid XML syntax at line ${line}: ${msg}`,
      );
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: XML_ATTRIBUTE_PREFIX,
      textNodeName: XML_TEXT_KEY,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      ignoreDeclaration: true,
      ignorePiTags: true,
      maxNestedTags: maxDepth,
    });

    try {
      return parser.parse(text) as unknown;
    } catch (error) {
      throw new ConversionError(
        'SYNTAX_ERROR',
        `Invalid XML: ${(error as Error).message}`,
      );
    }
  }

  createWriter(): RecordWriter {
    return new XmlRecordWriter((value) => this.toNode(value));
  }

  serialize(data: unknown): string {
    const tree = { [XML_ROOT_ELEMENT]: this.toNode(data) };

    return `${XML_DECLARATION}${XML_BUILDER.build(tree) as string}`;
  }

  private toNode(value: unknown): unknown {
    if (Array.isArray(value)) {
      return { [XML_ITEM_ELEMENT]: value.map((item) => this.toNode(item)) };
    }

    if (!isPlainObject(value)) {
      return toText(value);
    }

    const node: PlainObject = {};

    for (const [key, child] of Object.entries(value)) {
      if (key === XML_TEXT_KEY) {
        node[XML_TEXT_KEY] = toText(child);
      } else if (key.startsWith(XML_ATTRIBUTE_PREFIX) && key.length > 1) {
        node[`${XML_ATTRIBUTE_PREFIX}${toElementName(key.slice(1))}`] =
          toText(child);
      } else {
        const name = this.uniqueName(node, toElementName(key));

        node[name] = Array.isArray(child)
          ? child.map((item) => this.toNode(item))
          : this.toNode(child);
      }
    }

    return node;
  }

  private uniqueName(node: PlainObject, name: string): string {
    let candidate = name;

    for (let index = 2; candidate in node; index++) {
      candidate = `${name}_${index}`;
    }

    return candidate;
  }
}
