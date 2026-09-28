import { ConversionError } from './conversion-error';

const BYTE_ORDER_MARK = '﻿';

const detectEncoding = (buffer: Buffer): string => {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';

  return 'utf-8';
};

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

  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
};

export const decodeHead = (buffer: Buffer): string => {
  const text = new TextDecoder(detectEncoding(buffer)).decode(buffer);

  return (text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text).trimStart();
};
