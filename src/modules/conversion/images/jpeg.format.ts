import { Sharp } from 'sharp';
import { RasterFormatHandler } from './image-format-handler';
import { ImageLimits, ImageTransformOptions } from './image-format.types';
import { openRaster } from './raster-input';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export class JpegFormatHandler extends RasterFormatHandler {
  readonly format = 'jpeg';
  readonly extensions = ['.jpg', '.jpeg'];
  readonly mimeType = 'image/jpeg';

  override get mimeTypes(): readonly string[] {
    return [this.mimeType, 'image/jpg', 'image/pjpeg'];
  }

  matchesSignature(head: Buffer): boolean {
    return head.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
  }

  load(input: Buffer, _options: unknown, limits: ImageLimits): Promise<Sharp> {
    return openRaster(input, limits);
  }

  encode(
    pipeline: Sharp,
    { quality, background }: ImageTransformOptions,
  ): Sharp {
    return pipeline.flatten({ background }).jpeg({ quality });
  }
}
