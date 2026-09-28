import type { Sharp } from 'sharp';
import {
  ImageFormat,
  ImageFormatKind,
  ImageLimits,
  ImageTransformOptions,
} from './image-format.types';

export abstract class ImageFormatHandler {
  abstract readonly format: ImageFormat;
  abstract readonly kind: ImageFormatKind;
  abstract readonly extensions: readonly string[];
  abstract readonly mimeType: string;

  get mimeTypes(): readonly string[] {
    return [this.mimeType];
  }

  abstract matchesSignature(head: Buffer): boolean;

  abstract load(
    input: Buffer,
    options: ImageTransformOptions,
    limits: ImageLimits,
  ): Promise<Sharp>;
}

export abstract class RasterFormatHandler extends ImageFormatHandler {
  readonly kind = 'raster';

  abstract encode(pipeline: Sharp, options: ImageTransformOptions): Sharp;
}

export const isRasterHandler = (
  handler: ImageFormatHandler,
): handler is RasterFormatHandler => handler instanceof RasterFormatHandler;
