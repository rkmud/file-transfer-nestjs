import {
  ConversionErrorCode,
  ParseLimits,
  TextFormat,
} from '../formats/format.types';

export interface ConversionTask {
  inputPath: string;
  inputSize: number;
  outputPath: string;
  sourceFormat: TextFormat;
  targetFormat: TextFormat;
  limits: ParseLimits;
  streamThresholdBytes: number;
}

export type ConversionTaskResult =
  | { ok: true; outputSize: number }
  | { ok: false; code: ConversionErrorCode; message: string };
