import { ConversionError } from './conversion-error';
import { TextFormatHandler } from './format-handler';
import { FormatMatch } from './format.types';

export class JsonFormatHandler extends TextFormatHandler {
  readonly format = 'json';
  readonly extensions = ['.json'];
  readonly mimeType = 'application/json';

  sniff(head: string): FormatMatch {
    if (/^[{[]/.test(head)) return FormatMatch.Certain;
    if (/^("|-?\d|true\b|false\b|null\b)/.test(head)) {
      return FormatMatch.Possible;
    }

    return FormatMatch.No;
  }

  parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch (error) {
      const position = /position (\d+)/.exec((error as Error).message)?.[1];

      throw new ConversionError(
        'SYNTAX_ERROR',
        position
          ? `Invalid JSON syntax at position ${position}`
          : 'Invalid JSON syntax',
      );
    }
  }

  serialize(data: unknown): string {
    return `${JSON.stringify(data ?? null, null, 2)}\n`;
  }
}
