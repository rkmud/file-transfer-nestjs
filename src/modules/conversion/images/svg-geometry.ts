import { Dimensions } from './image-format.types';

export const SVG_DEFAULT_SIZE = 1024;

const CSS_PX_PER_UNIT: Record<string, number> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
  pc: 16,
};

const LENGTH_PATTERN =
  /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i;

export const parseSvgLength = (value: string | undefined): number | null => {
  if (value === undefined) return null;

  const match = LENGTH_PATTERN.exec(value);

  if (!match) return null;

  const factor = CSS_PX_PER_UNIT[match[2].toLowerCase()];
  const length = Number(match[1]) * (factor ?? NaN);

  return Number.isFinite(length) && length > 0 ? length : null;
};

export const parseViewBox = (value: string | undefined): Dimensions | null => {
  if (value === undefined) return null;

  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);

  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [, , width, height] = parts;

  return width > 0 && height > 0 ? { width, height } : null;
};

export const resolveIntrinsicSize = (
  width: string | undefined,
  height: string | undefined,
  viewBox: string | undefined,
): Dimensions | null => {
  const box = parseViewBox(viewBox);
  const w = parseSvgLength(width);
  const h = parseSvgLength(height);

  if (w !== null && h !== null) return { width: w, height: h };
  if (w !== null && box)
    return { width: w, height: (w * box.height) / box.width };
  if (h !== null && box)
    return { width: (h * box.width) / box.height, height: h };

  return box;
};

const toPixels = (value: number): number => Math.max(1, Math.round(value));

export const resolveRasterSize = (
  intrinsic: Dimensions | null,
  requested: Partial<Dimensions>,
): Dimensions => {
  const aspect = intrinsic ? intrinsic.width / intrinsic.height : 1;
  const { width, height } = requested;

  if (width !== undefined && height !== undefined) {
    return { width, height };
  }

  if (width !== undefined) {
    return { width, height: toPixels(width / aspect) };
  }

  if (height !== undefined) {
    return { width: toPixels(height * aspect), height };
  }

  if (intrinsic) {
    return {
      width: toPixels(intrinsic.width),
      height: toPixels(intrinsic.height),
    };
  }

  return { width: SVG_DEFAULT_SIZE, height: SVG_DEFAULT_SIZE };
};
