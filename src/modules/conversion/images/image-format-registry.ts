import { ImageConversionError } from './image-conversion-error';
import {
  ImageFormatHandler,
  isRasterHandler,
  RasterFormatHandler,
} from './image-format-handler';
import { ImageFormat } from './image-format.types';
import { JpegFormatHandler } from './jpeg.format';
import { PngFormatHandler } from './png.format';
import { SvgFormatHandler } from './svg.format';

export class ImageFormatRegistry {
  private readonly handlers = new Map<string, ImageFormatHandler>();

  constructor(handlers: ImageFormatHandler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.format, handler);
    }
  }

  all(): ImageFormatHandler[] {
    return [...this.handlers.values()];
  }

  has(format: string): format is ImageFormat {
    return this.handlers.has(format);
  }

  get(format: ImageFormat): ImageFormatHandler {
    const handler = this.handlers.get(format);

    if (!handler) {
      throw new Error(`No handler registered for image format "${format}"`);
    }

    return handler;
  }

  findByExtension(extension: string): ImageFormatHandler | undefined {
    return this.all().find((handler) => handler.extensions.includes(extension));
  }

  findBySignature(head: Buffer): ImageFormatHandler | undefined {
    return this.all().find((handler) => handler.matchesSignature(head));
  }

  targetsFor(source: ImageFormatHandler): RasterFormatHandler[] {
    return this.all()
      .filter(isRasterHandler)
      .filter((target) => target.format !== source.format);
  }

  resolveTarget(
    source: ImageFormatHandler,
    target: ImageFormatHandler,
  ): RasterFormatHandler {
    if (!isRasterHandler(target) && isRasterHandler(source)) {
      throw new ImageConversionError(
        'VECTORIZATION_NOT_SUPPORTED',
        `Conversion from ${source.format} to ${target.format} (vectorization) is not supported`,
      );
    }

    const allowed = this.targetsFor(source).find(
      (handler) => handler.format === target.format,
    );

    if (!allowed) {
      throw new ImageConversionError(
        'UNSUPPORTED_DIRECTION',
        `Conversion from ${source.format} to ${target.format} is not supported`,
      );
    }

    return allowed;
  }
}

export const createImageFormatRegistry = (): ImageFormatRegistry =>
  new ImageFormatRegistry([
    new PngFormatHandler(),
    new JpegFormatHandler(),
    new SvgFormatHandler(),
  ]);
