import { Sharp } from 'sharp';
import { RasterFormatHandler } from './image-format-handler';
import { ImageLimits, ImageTransformOptions } from './image-format.types';
import { openRaster } from './raster-input';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export class PngFormatHandler extends RasterFormatHandler {
  readonly format = 'png';
  readonly extensions = ['.png'];
  readonly mimeType = 'image/png';

  matchesSignature(head: Buffer): boolean {
    return head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  }

  load(input: Buffer, _options: unknown, limits: ImageLimits): Promise<Sharp> {
    return openRaster(input, limits);
  }

  encode(pipeline: Sharp, { background }: ImageTransformOptions): Sharp {
    return pipeline.flatten({ background }).ensureAlpha(1).png();
  }
}
