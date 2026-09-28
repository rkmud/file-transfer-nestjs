import {
  ConversionErrorCode,
  ParseLimits,
  TextFormat,
} from '../formats/format.types';

export interface ConversionTask {
  inputPath: string;
  outputPath: string;
  sourceFormat: TextFormat;
  targetFormat: TextFormat;
  limits: ParseLimits;
}

export type ConversionTaskResult =
  | { ok: true; outputSize: number }
  | { ok: false; code: ConversionErrorCode; message: string };
