import { FormatMatch, ParseLimits, TextFormat } from './format.types';
import { RecordWriter } from './record-stream';

export abstract class TextFormatHandler {
  abstract readonly format: TextFormat;
  abstract readonly extensions: readonly string[];
  abstract readonly mimeType: string;

  abstract sniff(head: string): FormatMatch;

  abstract parse(text: string, limits: ParseLimits): unknown;

  abstract serialize(data: unknown): string;

  canStream?(head: string): boolean;

  readRecords?(
    text: AsyncIterable<string>,
    limits: ParseLimits,
  ): AsyncIterable<unknown>;

  createWriter?(): RecordWriter;
}

export interface StreamingSourceHandler extends TextFormatHandler {
  canStream(head: string): boolean;
  readRecords(
    text: AsyncIterable<string>,
    limits: ParseLimits,
  ): AsyncIterable<unknown>;
}

export interface StreamingTargetHandler extends TextFormatHandler {
  createWriter(): RecordWriter;
}

export const isStreamingSource = (
  handler: TextFormatHandler,
): handler is StreamingSourceHandler =>
  typeof handler.canStream === 'function' &&
  typeof handler.readRecords === 'function';

export const isStreamingTarget = (
  handler: TextFormatHandler,
): handler is StreamingTargetHandler =>
  typeof handler.createWriter === 'function';
