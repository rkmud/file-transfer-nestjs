import { ConversionError } from './conversion-error';

const BYTE_ORDER_MARK = '﻿';

const ENCODING_DETECTION_BYTES = 2;

const detectEncoding = (buffer: Buffer): string => {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';

  return 'utf-8';
};

const decodeChunk = (
  decoder: TextDecoder,
  buffer?: Buffer,
  stream = true,
): string => {
  try {
    return buffer ? decoder.decode(buffer, { stream }) : decoder.decode();
  } catch {
    throw new ConversionError(
      'INVALID_ENCODING',
      'File is not valid UTF-8 text',
    );
  }
};

const stripByteOrderMark = (text: string): string =>
  text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;

export const decodeText = (buffer: Buffer): string => {
  let text: string;

  try {
    text = new TextDecoder(detectEncoding(buffer), { fatal: true }).decode(
      buffer,
    );
  } catch {
    throw new ConversionError(
      'INVALID_ENCODING',
      'File is not valid UTF-8 text',
    );
  }

  return stripByteOrderMark(text);
};

export const decodeHead = (buffer: Buffer): string => {
  const text = new TextDecoder(detectEncoding(buffer)).decode(buffer);

  return stripByteOrderMark(text).trimStart();
};

export async function* decodeTextStream(
  source: AsyncIterable<Buffer>,
): AsyncGenerator<string> {
  let decoder: TextDecoder | undefined;
  let head: Buffer = Buffer.alloc(0);
  let atStart = true;

  const emit = (text: string): string => {
    if (!atStart || text === '') return text;
    atStart = false;

    return stripByteOrderMark(text);
  };

  for await (const chunk of source) {
    if (!decoder) {
      head = head.length === 0 ? chunk : Buffer.concat([head, chunk]);

      if (head.length < ENCODING_DETECTION_BYTES) continue;

      decoder = new TextDecoder(detectEncoding(head), { fatal: true });

      const text = emit(decodeChunk(decoder, head));

      if (text !== '') yield text;
      continue;
    }

    const text = emit(decodeChunk(decoder, chunk));

    if (text !== '') yield text;
  }

  if (!decoder) {
    decoder = new TextDecoder(detectEncoding(head), { fatal: true });

    const text = emit(decodeChunk(decoder, head));

    if (text !== '') yield text;
  }

  const tail = emit(decodeChunk(decoder, undefined, false));

  if (tail !== '') yield tail;
}
