import sharp, { Sharp } from 'sharp';
import { ImageConversionError } from './image-conversion-error';
import { ImageFormatHandler } from './image-format-handler';
import { ImageLimits, ImageTransformOptions } from './image-format.types';
import { resolveRasterSize } from './svg-geometry';
import { sanitizeSvg } from './svg-sanitizer';

const UTF8_BOM = '﻿';
const SVG_ROOT = /<(?:[\w.-]+:)?svg[\s/>]/;
const SVG_RENDER_DENSITY = 72;

export class SvgFormatHandler extends ImageFormatHandler {
  readonly format = 'svg';
  readonly kind = 'vector';
  readonly extensions = ['.svg'];
  readonly mimeType = 'image/svg+xml';

  override get mimeTypes(): readonly string[] {
    return [this.mimeType, 'application/xml', 'text/xml'];
  }

  matchesSignature(head: Buffer): boolean {
    if (head.includes(0)) return false;

    const text = head.toString('utf8').replace(UTF8_BOM, '').trimStart();

    return text.startsWith('<') && SVG_ROOT.test(text);
  }

  load(
    input: Buffer,
    { width, height }: ImageTransformOptions,
    { maxRasterWidth, maxRasterHeight, maxInputPixels }: ImageLimits,
  ): Promise<Sharp> {
    const svg = sanitizeSvg(input.toString('utf8').replace(UTF8_BOM, ''));
    const size = resolveRasterSize(svg.intrinsicSize, { width, height });

    if (size.width > maxRasterWidth || size.height > maxRasterHeight) {
      throw new ImageConversionError(
        'EXCEEDED_MAX_DIMENSIONS',
        `Rasterized size ${size.width}x${size.height} exceeds the ${maxRasterWidth}x${maxRasterHeight} px limit`,
      );
    }

    const pipeline = sharp(Buffer.from(svg.render(size), 'utf8'), {
      density: SVG_RENDER_DENSITY,
      limitInputPixels: maxInputPixels,
      failOn: 'error',
    }).resize(size.width, size.height, { fit: 'fill' });

    return Promise.resolve(pipeline);
  }
}
