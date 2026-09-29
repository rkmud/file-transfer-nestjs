import { ConversionError } from './conversion-error';
import { TextFormatHandler } from './format-handler';
import { FormatMatch } from './format.types';
import { readJsonArray } from './json-stream';
import { RecordWriter } from './record-stream';

const EMPTY_ARRAY = '[]\n';

const INDENT = '  ';

const indentBlock = (text: string): string =>
  text
    .split('\n')
    .map((line) => `${INDENT}${line}`)
    .join('\n');

class JsonRecordWriter implements RecordWriter {
  private wrote = false;

  write(record: unknown): string {
    const separator = this.wrote ? ',\n' : '[\n';

    this.wrote = true;

    return `${separator}${indentBlock(JSON.stringify(record ?? null, null, 2))}`;
  }

  end(): string {
    return this.wrote ? '\n]\n' : EMPTY_ARRAY;
  }
}

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

  canStream(head: string): boolean {
    return head.startsWith('[');
  }

  readRecords(text: AsyncIterable<string>): AsyncIterable<unknown> {
    return readJsonArray(text);
  }

  createWriter(): RecordWriter {
    return new JsonRecordWriter();
  }

  serialize(data: unknown): string {
    return `${JSON.stringify(data ?? null, null, 2)}\n`;
  }
}
