import sharp, { Sharp } from 'sharp';
import { ImageConversionError } from './image-conversion-error';
import { ImageLimits } from './image-format.types';

export const openRaster = async (
  input: Buffer,
  { maxInputPixels }: ImageLimits,
): Promise<Sharp> => {
  let width: number | undefined;
  let height: number | undefined;

  try {
    ({ width, height } = await sharp(input, {
      limitInputPixels: false,
    }).metadata());
  } catch {
    throw new ImageConversionError('INVALID_IMAGE', 'Image data is corrupted');
  }

  if (!width || !height) {
    throw new ImageConversionError(
      'INVALID_IMAGE',
      'Image dimensions are missing',
    );
  }

  if (width * height > maxInputPixels) {
    throw new ImageConversionError(
      'EXCEEDED_MAX_PIXELS',
      `Image exceeds the ${maxInputPixels} pixel limit`,
    );
  }

  return sharp(input, {
    limitInputPixels: maxInputPixels,
    failOn: 'error',
    autoOrient: true,
  });
};
