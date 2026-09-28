import { CsvError, parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { ConversionError } from './conversion-error';
import { TextFormatHandler } from './format-handler';
import { FormatMatch } from './format.types';
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

const hasHeaderRow = (rows: string[][]): boolean => {
  const [first] = rows;

  return (
    rows.length > 1 &&
    new Set(first).size === first.length &&
    first.every((cell) => cell.trim() !== '' && !NUMERIC_CELL.test(cell.trim()))
  );
};

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
      if (error instanceof CsvError) {
        throw new ConversionError(
          'SYNTAX_ERROR',
          `Invalid CSV: ${error.message}`,
        );
      }

      throw error;
    }

    if (!hasHeaderRow(rows)) {
      return rows;
    }

    const [header, ...records] = rows;

    return records.map((record) =>
      Object.fromEntries(header.map((key, index) => [key, record[index]])),
    );
  }

  serialize(data: unknown): string {
    const records = extractRecords(data);

    if (records.length === 0) {
      return '';
    }

    if (records.every(Array.isArray)) {
      return this.write(records.map((record) => record.map(toCell)));
    }

    const flattened = records.map((record) =>
      isPlainObject(record)
        ? flatten(record)
        : { [CSV_VALUE_COLUMN]: toCell(record) },
    );
    const columns = [...new Set(flattened.flatMap(Object.keys))];

    return this.write([
      columns,
      ...flattened.map((row) => columns.map((column) => row[column] ?? '')),
    ]);
  }

  private write(rows: string[][]): string {
    return stringify(rows, { record_delimiter: 'windows' });
  }
}
