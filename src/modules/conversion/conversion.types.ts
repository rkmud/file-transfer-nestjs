import { ReadStream } from 'fs';
import { TextFormat } from './formats/format.types';

export interface ConversionDirections {
  source: TextFormat;
  target: TextFormat[];
}

export interface ConversionRequest {
  userId: string;
  file: Express.Multer.File | undefined;
  targetFormat: string;
}

export interface ConversionResult {
  stream: ReadStream;
  mimeType: string;
  fileName: string;
  size: number;
}
