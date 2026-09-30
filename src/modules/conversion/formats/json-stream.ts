import { ConversionError } from './conversion-error';

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

const STRUCTURAL = /["{}[\],]/g;

const syntaxError = (position: number, detail?: string): ConversionError =>
  new ConversionError(
    'SYNTAX_ERROR',
    `Invalid JSON syntax at position ${position}${detail ? `: ${detail}` : ''}`,
  );

const isEscaped = (text: string, index: number): boolean => {
  let backslashes = 0;

  while (index - backslashes > 0 && text[index - backslashes - 1] === '\\') {
    backslashes++;
  }

  return backslashes % 2 === 1;
};

const parseRecord = (text: string, offset: number): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const position = /position (\d+)/.exec((error as Error).message)?.[1];

    throw position === undefined
      ? new ConversionError('SYNTAX_ERROR', 'Invalid JSON syntax')
      : syntaxError(offset + Number(position));
  }
};

export async function* readJsonArray(
  chunks: AsyncIterable<string>,
): AsyncGenerator<unknown> {
  let buffer = '';
  let base = 0;
  let cursor = 0;
  let opened = false;
  let closed = false;
  let expectRecord = true;
  let start = -1;
  let depth = 0;
  let inString = false;

  const discardConsumed = (): void => {
    if (cursor === 0) return;

    buffer = buffer.slice(cursor);
    base += cursor;
    cursor = 0;
  };

  for await (const chunk of chunks) {
    if (start < 0) discardConsumed();

    buffer += chunk;

    scan: for (;;) {
      if (start < 0) {
        while (cursor < buffer.length && WHITESPACE.has(buffer[cursor])) {
          cursor++;
        }

        if (cursor === buffer.length) break;

        const character = buffer[cursor];

        if (closed) {
          throw syntaxError(base + cursor, 'unexpected trailing content');
        }

        if (!opened) {
          if (character !== '[') {
            throw syntaxError(base + cursor, 'document is not an array');
          }

          opened = true;
          cursor++;
          continue;
        }

        if (character === ']') {
          closed = true;
          cursor++;
          continue;
        }

        if (character === ',') {
          if (expectRecord) {
            throw syntaxError(base + cursor, 'unexpected comma');
          }

          expectRecord = true;
          cursor++;
          continue;
        }

        if (!expectRecord) {
          throw syntaxError(base + cursor, 'expected "," or "]"');
        }

        start = cursor;
        depth = 0;
        inString = false;
      }

      STRUCTURAL.lastIndex = cursor;

      for (;;) {
        const match = STRUCTURAL.exec(buffer);

        if (!match) {
          cursor = buffer.length;
          break scan;
        }

        const character = match[0];
        const index = match.index;

        cursor = index + 1;

        if (inString) {
          if (character === '"' && !isEscaped(buffer, index)) inString = false;
          continue;
        }

        if (character === '"') {
          inString = true;
          continue;
        }

        if (character === '{' || character === '[') {
          depth++;
          continue;
        }

        if (depth > 0) {
          if (character === ',') continue;

          depth--;

          if (depth > 0) continue;

          yield parseRecord(buffer.slice(start, cursor), base + start);
          start = -1;
          expectRecord = false;
          continue scan;
        }

        cursor = index;
        yield parseRecord(buffer.slice(start, cursor), base + start);
        start = -1;
        expectRecord = false;
        continue scan;
      }
    }
  }
  if (start >= 0 || !opened || !closed) {
    throw syntaxError(base + buffer.length, 'unexpected end of input');
  }
}
