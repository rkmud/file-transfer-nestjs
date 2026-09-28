import { FormatMatch, ParseLimits, TextFormat } from './format.types';

export abstract class TextFormatHandler {
  abstract readonly format: TextFormat;
  abstract readonly extensions: readonly string[];
  abstract readonly mimeType: string;

  abstract sniff(head: string): FormatMatch;

  abstract parse(text: string, limits: ParseLimits): unknown;

  abstract serialize(data: unknown): string;
}
