import { ImageConversionError } from './image-conversion-error';
import { isRasterHandler } from './image-format-handler';
import {
  createImageFormatRegistry,
  ImageFormatRegistry,
} from './image-format-registry';
import { JpegFormatHandler } from './jpeg.format';
import { PngFormatHandler } from './png.format';
import { SvgFormatHandler } from './svg.format';

describe('ImageFormatRegistry', () => {
  const registry = createImageFormatRegistry();
  const png = registry.get('png');
  const jpeg = registry.get('jpeg');
  const svg = registry.get('svg');

  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(ImageConversionError);
      expect((error as Error).name).toBe('ImageConversionError');
      return (error as ImageConversionError).code;
    }
    return undefined;
  };

  it('registers png, jpeg and svg handlers', () => {
    expect(registry.all().map((h) => h.format)).toEqual(['png', 'jpeg', 'svg']);
    expect(png).toBeInstanceOf(PngFormatHandler);
    expect(jpeg).toBeInstanceOf(JpegFormatHandler);
    expect(svg).toBeInstanceOf(SvgFormatHandler);
    expect(registry.has('png')).toBe(true);
    expect(registry.has('gif')).toBe(false);
  });

  it('throws for an unregistered format', () => {
    expect(() => new ImageFormatRegistry([]).get('png')).toThrow(
      'No handler registered for image format "png"',
    );
  });

  it('finds handlers by extension and signature', () => {
    expect(registry.findByExtension('.jpg')).toBe(jpeg);
    expect(registry.findByExtension('.jpeg')).toBe(jpeg);
    expect(registry.findByExtension('.svg')).toBe(svg);
    expect(registry.findByExtension('.gif')).toBeUndefined();
    expect(registry.findBySignature(Buffer.from([0xff, 0xd8, 0xff]))).toBe(
      jpeg,
    );
    expect(registry.findBySignature(Buffer.from('nothing'))).toBeUndefined();
  });

  it('classifies raster and vector handlers', () => {
    expect(isRasterHandler(png)).toBe(true);
    expect(isRasterHandler(jpeg)).toBe(true);
    expect(isRasterHandler(svg)).toBe(false);
    expect(png.kind).toBe('raster');
    expect(svg.kind).toBe('vector');
    expect(png.mimeTypes).toEqual(['image/png']);
  });

  it('allows any raster target other than the source', () => {
    expect(registry.targetsFor(png).map((h) => h.format)).toEqual(['jpeg']);
    expect(registry.targetsFor(jpeg).map((h) => h.format)).toEqual(['png']);
    expect(registry.targetsFor(svg).map((h) => h.format)).toEqual([
      'png',
      'jpeg',
    ]);
  });

  it.each([
    ['png', 'jpeg'],
    ['jpeg', 'png'],
    ['svg', 'png'],
    ['svg', 'jpeg'],
  ] as const)('resolves %s -> %s', (source, target) => {
    expect(
      registry.resolveTarget(registry.get(source), registry.get(target)),
    ).toBe(registry.get(target));
  });

  it('rejects vectorization (raster -> svg)', () => {
    expect(codeOf(() => registry.resolveTarget(png, svg))).toBe(
      'VECTORIZATION_NOT_SUPPORTED',
    );
    expect(codeOf(() => registry.resolveTarget(jpeg, svg))).toBe(
      'VECTORIZATION_NOT_SUPPORTED',
    );
  });

  it('rejects a same-format target and svg -> svg', () => {
    expect(codeOf(() => registry.resolveTarget(png, png))).toBe(
      'UNSUPPORTED_DIRECTION',
    );
    expect(codeOf(() => registry.resolveTarget(jpeg, jpeg))).toBe(
      'UNSUPPORTED_DIRECTION',
    );
    expect(codeOf(() => registry.resolveTarget(svg, svg))).toBe(
      'UNSUPPORTED_DIRECTION',
    );
  });
});
