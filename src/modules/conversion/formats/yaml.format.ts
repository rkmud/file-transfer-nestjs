import { parseAllDocuments, stringify } from 'yaml';
import { ConversionError } from './conversion-error';
import { TextFormatHandler } from './format-handler';
import { FormatMatch, ParseLimits } from './format.types';

const YAML_VERSION = '1.2';

export class YamlFormatHandler extends TextFormatHandler {
  readonly format = 'yaml';
  readonly extensions = ['.yaml', '.yml'];
  readonly mimeType = 'application/yaml';

  sniff(head: string): FormatMatch {
    if (/^(---|%YAML)/.test(head)) return FormatMatch.Certain;
    if (head.startsWith('<')) return FormatMatch.No;

    const firstLine = head.split(/\r?\n/, 1)[0];

    if (/^- /.test(firstLine) || /^[^\s,"'#][^,]*?:(\s|$)/.test(firstLine)) {
      return FormatMatch.Likely;
    }

    return FormatMatch.Possible;
  }

  parse(text: string, { maxYamlAliases }: ParseLimits): unknown {
    const documents = parseAllDocuments(text, {
      version: YAML_VERSION,
      uniqueKeys: true,
      prettyErrors: false,
    });

    if (!Array.isArray(documents)) {
      return null;
    }

    const values = documents.map((document) => {
      const [error] = document.errors;

      if (error) {
        const line = error.linePos?.[0].line;

        throw new ConversionError(
          'SYNTAX_ERROR',
          `Invalid YAML syntax (${error.code})${line ? ` at line ${line}` : ''}`,
        );
      }

      try {
        return document.toJS({ maxAliasCount: maxYamlAliases }) as unknown;
      } catch (toJsError) {
        if (toJsError instanceof ReferenceError) {
          throw new ConversionError(
            'LIMIT_EXCEEDED',
            'YAML alias expansion exceeds the allowed limit',
          );
        }

        throw toJsError;
      }
    });

    if (values.length === 0) return null;

    return values.length === 1 ? values[0] : values;
  }

  serialize(data: unknown): string {
    return stringify(data ?? null, {
      version: YAML_VERSION,
      aliasDuplicateObjects: false,
      lineWidth: 0,
    });
  }
}
