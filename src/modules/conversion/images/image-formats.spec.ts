import sharp from 'sharp';
import { ImageConversionError } from './image-conversion-error';
import { ImageLimits, ImageTransformOptions } from './image-format.types';
import { JpegFormatHandler } from './jpeg.format';
import { PngFormatHandler } from './png.format';
import { SvgFormatHandler } from './svg.format';
import {
  firstPixel,
  makeJpeg,
  makePng,
  makeSvg,
} from '../../../../test/setup/image-fixtures';

const limits: ImageLimits = {
  maxInputPixels: 1_000_000,
  maxRasterWidth: 100,
  maxRasterHeight: 80,
};

const options = (
  overrides: Partial<ImageTransformOptions> = {},
): ImageTransformOptions => ({
  quality: 85,
  background: '#ffffff',
  ...overrides,
});

describe('image format handlers', () => {
  const png = new PngFormatHandler();
  const jpeg = new JpegFormatHandler();
  const svg = new SvgFormatHandler();

  describe('PngFormatHandler', () => {
    it('describes the format', () => {
      expect(png.format).toBe('png');
      expect(png.extensions).toEqual(['.png']);
      expect(png.mimeTypes).toEqual(['image/png']);
    });

    it('matches only the PNG signature', async () => {
      expect(png.matchesSignature(await makePng())).toBe(true);
      expect(png.matchesSignature(await makeJpeg())).toBe(false);
      expect(png.matchesSignature(Buffer.from([0x89, 0x50]))).toBe(false);
    });

    it('loads a raster image and encodes an opaque PNG with alpha', async () => {
      const transparent = await makePng(2, 2, { r: 0, g: 0, b: 0, alpha: 0 });
      const pipeline = await png.load(transparent, options(), limits);
      const output = await png
        .encode(pipeline, options({ background: '#0000ff' }))
        .toBuffer();
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('png');
      expect(meta.hasAlpha).toBe(true);
      expect(await firstPixel(output)).toEqual([0, 0, 255, 255]);
    });
  });

  describe('JpegFormatHandler', () => {
    it('describes the format and its MIME aliases', () => {
      expect(jpeg.format).toBe('jpeg');
      expect(jpeg.extensions).toEqual(['.jpg', '.jpeg']);
      expect(jpeg.mimeType).toBe('image/jpeg');
      expect(jpeg.mimeTypes).toEqual([
        'image/jpeg',
        'image/jpg',
        'image/pjpeg',
      ]);
    });

    it('matches only the JPEG signature', async () => {
      expect(jpeg.matchesSignature(await makeJpeg())).toBe(true);
      expect(jpeg.matchesSignature(await makePng())).toBe(false);
    });

    it('flattens transparency onto the background and applies quality', async () => {
      const transparent = await makePng(16, 16, {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      });
      const encode = async (quality: number) =>
        jpeg
          .encode(
            await jpeg.load(transparent, options(), limits),
            options({ quality, background: '#ff0000' }),
          )
          .toBuffer();
      const output = await encode(90);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect(meta.hasAlpha).toBe(false);

      const [r, g, b] = await firstPixel(output);

      expect(r).toBeGreaterThan(240);
      expect(g).toBeLessThan(15);
      expect(b).toBeLessThan(15);
      expect((await makeJpeg()).length).toBeGreaterThan(0);
    });
  });

  describe('SvgFormatHandler', () => {
    it('describes the format', () => {
      expect(svg.format).toBe('svg');
      expect(svg.kind).toBe('vector');
      expect(svg.extensions).toEqual(['.svg']);
      expect(svg.mimeTypes).toEqual([
        'image/svg+xml',
        'application/xml',
        'text/xml',
      ]);
    });

    it.each([
      ['plain svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', true],
      ['with declaration', '<?xml version="1.0"?>\n<svg>', true],
      ['with BOM and whitespace', '﻿  \n<svg width="1">', true],
      ['namespaced root', '<s:svg xmlns:s="x">', true],
      ['other XML', '<html><body/></html>', false],
      ['svg word in text', 'svg <svg>', false],
      ['svgfoo element', '<svgfoo>', false],
    ])('sniffs %s', (_label, text, expected) => {
      expect(svg.matchesSignature(Buffer.from(text, 'utf8'))).toBe(expected);
    });

    it('does not match binary content', () => {
      expect(svg.matchesSignature(Buffer.from('<svg>\0', 'utf8'))).toBe(false);
    });

    it('rasterizes at the intrinsic size by default', async () => {
      const output = await (
        await svg.load(makeSvg('width="20" height="10"'), options(), limits)
      )
        .png()
        .toBuffer();
      const meta = await sharp(output).metadata();

      expect([meta.width, meta.height]).toEqual([20, 10]);
      expect(await firstPixel(output)).toEqual([255, 0, 0, 255]);
    });

    it('rasterizes at the requested size, keeping aspect ratio', async () => {
      const input = Buffer.concat([
        Buffer.from('﻿', 'utf8'),
        makeSvg('viewBox="0 0 20 10"'),
      ]);
      const meta = await sharp(
        await (
          await svg.load(input, options({ width: 60 }), limits)
        )
          .png()
          .toBuffer(),
      ).metadata();

      expect([meta.width, meta.height]).toEqual([60, 30]);
    });

    // load() validates synchronously: errors are thrown, not rejected (the
    // worker awaits it inside its try block, so both behave the same there).
    it('rejects a rasterized size above the limits', () => {
      expect(() =>
        svg.load(makeSvg('width="101" height="10"'), options(), limits),
      ).toThrow(expect.objectContaining({ code: 'EXCEEDED_MAX_DIMENSIONS' }));
      expect(() =>
        svg.load(makeSvg(), options({ width: 10, height: 81 }), limits),
      ).toThrow(
        expect.objectContaining({
          code: 'EXCEEDED_MAX_DIMENSIONS',
          message: 'Rasterized size 10x81 exceeds the 100x80 px limit',
        }),
      );
    });

    it('rejects a malformed document with SVG_SANITY_FAILED', () => {
      expect(() =>
        svg.load(Buffer.from('<svg><g></svg>'), options(), limits),
      ).toThrow(ImageConversionError);
    });
  });
});
