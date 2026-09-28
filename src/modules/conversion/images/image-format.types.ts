export const IMAGE_FORMATS = ['png', 'jpeg', 'svg'] as const;

export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export type ImageFormatKind = 'raster' | 'vector';

export interface ImageLimits {
  maxInputPixels: number;
  maxRasterWidth: number;
  maxRasterHeight: number;
}

export interface ImageTransformOptions {
  quality: number;
  width?: number;
  height?: number;
  background: string;
}

export interface Dimensions {
  width: number;
  height: number;
}

export type ImageConversionErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'VECTORIZATION_NOT_SUPPORTED'
  | 'UNSUPPORTED_DIRECTION'
  | 'FILE_TOO_LARGE'
  | 'INVALID_IMAGE'
  | 'SVG_SANITY_FAILED'
  | 'EXCEEDED_MAX_DIMENSIONS'
  | 'EXCEEDED_MAX_PIXELS'
  | 'TIMEOUT'
  | 'INTERNAL';
