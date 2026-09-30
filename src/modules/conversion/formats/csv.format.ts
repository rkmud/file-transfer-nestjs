import { CsvError as StreamCsvError, parse as parseStream } from 'csv-parse';
import { CsvError, parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { Readable } from 'stream';
import { ConversionError } from './conversion-error';
import { TextFormatHandler } from './format-handler';
import { FormatMatch } from './format.types';
import { RecordWriter } from './record-stream';
import { isPlainObject, PlainObject } from './structure';

export const CSV_VALUE_COLUMN = 'value';

const NUMERIC_CELL = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

const toCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);

  return String(value);
};

const flatten = (
  value: PlainObject,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> => {
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}${key}`;

    if (isPlainObject(child) && Object.keys(child).length > 0) {
      flatten(child, `${path}.`, out);
    } else {
      out[path] = toCell(child);
    }
  }

  return out;
};

const extractRecords = (data: unknown): unknown[] => {
  let current = data;

  while (isPlainObject(current)) {
    const values = Object.values(current);

    if (values.length !== 1) break;
    current = values[0];
  }

  return Array.isArray(current) ? current : [data];
};

const isHeaderRow = (row: string[]): boolean =>
  new Set(row).size === row.length &&
  row.every((cell) => cell.trim() !== '' && !NUMERIC_CELL.test(cell.trim()));

const hasHeaderRow = (rows: string[][]): boolean =>
  rows.length > 1 && isHeaderRow(rows[0]);

const toRecord = (header: string[], row: string[]): PlainObject =>
  Object.fromEntries(header.map((key, index) => [key, row[index]]));

const rethrowAsConversionError: (error: unknown) => never = (error) => {
  if (error instanceof CsvError || error instanceof StreamCsvError) {
    throw new ConversionError('SYNTAX_ERROR', `Invalid CSV: ${error.message}`);
  }

  throw error;
};

const writeRows = (rows: string[][]): string =>
  stringify(rows, { record_delimiter: 'windows' });

class CsvRecordWriter implements RecordWriter {
  readonly needsScan = true;

  private readonly columns = new Set<string>();
  private allArrays = true;
  private header: string[] = [];
  private wrote = false;

  scan(record: unknown): void {
    if (Array.isArray(record)) return;

    this.allArrays = false;

    if (isPlainObject(record)) {
      for (const column of Object.keys(flatten(record))) {
        this.columns.add(column);
      }
    } else {
      this.columns.add(CSV_VALUE_COLUMN);
    }
  }

  write(record: unknown): string {
    let prologue = '';

    if (!this.wrote) {
      this.wrote = true;
      this.header = [...this.columns];
      prologue = this.allArrays ? '' : writeRows([this.header]);
    }

    return `${prologue}${writeRows([this.toRow(record)])}`;
  }

  end(): string {
    return '';
  }

  private toRow(record: unknown): string[] {
    if (this.allArrays) {
      return (record as unknown[]).map(toCell);
    }

    const row = isPlainObject(record)
      ? flatten(record)
      : { [CSV_VALUE_COLUMN]: toCell(record) };

    return this.header.map((column) => row[column] ?? '');
  }
}

export class CsvFormatHandler extends TextFormatHandler {
  readonly format = 'csv';
  readonly extensions = ['.csv'];
  readonly mimeType = 'text/csv';

  sniff(head: string): FormatMatch {
    if (/^[<{[]/.test(head)) return FormatMatch.No;

    return head.split(/\r?\n/, 1)[0].includes(',')
      ? FormatMatch.Likely
      : FormatMatch.Possible;
  }

  parse(text: string): unknown {
    let rows: string[][];

    try {
      rows = parse(text, { skip_empty_lines: true }) as string[][];
    } catch (error) {
      rethrowAsConversionError(error);
    }

    if (!hasHeaderRow(rows)) {
      return rows;
    }

    const [header, ...records] = rows;

    return records.map((record) => toRecord(header, record));
  }

  canStream(): boolean {
    return true;
  }

  async *readRecords(text: AsyncIterable<string>): AsyncGenerator<unknown> {
    const source = Readable.from(text);
    const parser = parseStream({ skip_empty_lines: true });

    // `pipe()` does not forward source errors, so a failing text source (e.g.
    // INVALID_ENCODING from decodeTextStream) would leave the parser open and
    // hang the iteration below. Destroying it with the error ends the loop.
    source.on('error', (error: Error) => parser.destroy(error));
    source.pipe(parser);

    let header: string[] | undefined;
    let first: string[] | undefined;
    let index = 0;

    try {
      for await (const row of parser as AsyncIterable<string[]>) {
        if (index++ === 0) {
          first = row;
          continue;
        }

        if (first) {
          if (isHeaderRow(first)) {
            header = first;
          } else {
            yield first;
          }

          first = undefined;
        }

        yield header ? toRecord(header, row) : row;
      }
    } catch (error) {
      rethrowAsConversionError(error);
    } finally {
      source.destroy();
      parser.destroy();
    }

    if (first) yield first;
  }

  createWriter(): RecordWriter {
    return new CsvRecordWriter();
  }

  serialize(data: unknown): string {
    const records = extractRecords(data);

    if (records.length === 0) {
      return '';
    }

    if (records.every(Array.isArray)) {
      return writeRows(records.map((record) => record.map(toCell)));
    }

    const flattened = records.map((record) =>
      isPlainObject(record)
        ? flatten(record)
        : { [CSV_VALUE_COLUMN]: toCell(record) },
    );
    const columns = [...new Set(flattened.flatMap(Object.keys))];

    return writeRows([
      columns,
      ...flattened.map((row) => columns.map((column) => row[column] ?? '')),
    ]);
  }
}
