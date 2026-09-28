import { ReadStream } from 'fs';
import { TextFormat } from './formats/format.types';
import { ImageFormat } from './images/image-format.types';

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

export interface ImageConversionDirections {
  source: ImageFormat;
  target: ImageFormat[];
}

export interface ImageConversionRequest {
  userId: string;
  file: Express.Multer.File | undefined;
  targetFormat: ImageFormat;
  quality?: number;
  width?: number;
  height?: number;
  background?: string;
}
