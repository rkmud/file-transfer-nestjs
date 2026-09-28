import { ImageConversionErrorCode } from './image-format.types';

export class ImageConversionError extends Error {
  constructor(
    readonly code: ImageConversionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = ImageConversionError.name;
  }
}
