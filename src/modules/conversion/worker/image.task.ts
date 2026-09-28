import {
  ImageConversionErrorCode,
  ImageFormat,
  ImageLimits,
  ImageTransformOptions,
} from '../images/image-format.types';

export interface ImageTask {
  inputPath: string;
  outputPath: string;
  sourceFormat: ImageFormat;
  targetFormat: ImageFormat;
  options: ImageTransformOptions;
  limits: ImageLimits;
}

export type ImageTaskResult =
  | { ok: true; outputSize: number; width: number; height: number }
  | { ok: false; code: ImageConversionErrorCode; message: string };
