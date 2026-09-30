import { writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import convertImage from './image.worker';
import { ImageTask } from './image.task';
import {
  ImageFormat,
  ImageTransformOptions,
} from '../images/image-format.types';
import {
  firstPixel,
  makeJpeg,
  makeNoisyPng,
  makePng,
  makePngHeader,
  makeSvg,
  makeTruncatedPng,
} from '../../../../test/setup/image-fixtures';
import { makeTempDir, removeDir } from '../../../../test/setup/temp-dir';

describe('image worker (convertImage)', () => {
  let dir: string;
  let counter = 0;

  beforeAll(() => {
    dir = makeTempDir('ftn-image-worker-');
  });

  afterAll(() => removeDir(dir));

  const run = (
    input: Buffer | null,
    sourceFormat: ImageFormat,
    targetFormat: ImageFormat,
    overrides: {
      options?: Partial<ImageTransformOptions>;
      limits?: Partial<ImageTask['limits']>;
    } = {},
  ) => {
    counter += 1;

    const inputPath = join(dir, `in-${counter}`);
    const outputPath = join(dir, `out-${counter}.part`);

    if (input) writeFileSync(inputPath, input);

    const task: ImageTask = {
      inputPath,
      outputPath,
      sourceFormat,
      targetFormat,
      options: { quality: 85, background: '#ffffff', ...overrides.options },
      limits: {
        maxInputPixels: 50_000_000,
        maxRasterWidth: 4096,
        maxRasterHeight: 4096,
        ...overrides.limits,
      },
    };

    return { task, outputPath, result: convertImage(task) };
  };

  describe('successful conversions', () => {
    it('PNG -> JPEG flattens transparency onto white', async () => {
      const { result, outputPath } = run(
        await makePng(4, 3, { r: 0, g: 0, b: 0, alpha: 0 }),
        'png',
        'jpeg',
      );

      await expect(result).resolves.toMatchObject({
        ok: true,
        width: 4,
        height: 3,
      });

      const output = await readFile(outputPath);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('jpeg');
      expect((await result).ok && (await result)).toMatchObject({
        outputSize: output.length,
      });
      (await firstPixel(output)).forEach((channel) =>
        expect(channel).toBeGreaterThan(245),
      );
    });

    it('applies the JPEG quality factor', async () => {
      const noisy = await makeNoisyPng();
      const low = await run(noisy, 'png', 'jpeg', { options: { quality: 5 } })
        .result;
      const high = await run(noisy, 'png', 'jpeg', {
        options: { quality: 100 },
      }).result;

      expect(low.ok && high.ok).toBe(true);
      expect(low.ok && high.ok && low.outputSize < high.outputSize).toBe(true);
    });

    it('JPEG -> PNG adds a fully opaque alpha channel', async () => {
      const { result, outputPath } = run(await makeJpeg(5, 5), 'jpeg', 'png');

      await expect(result).resolves.toMatchObject({ ok: true, width: 5 });

      const output = await readFile(outputPath);
      const meta = await sharp(output).metadata();

      expect(meta.format).toBe('png');
      expect(meta.channels).toBe(4);
      expect((await firstPixel(output))[3]).toBe(255);
    });

    it('ignores width/height for raster sources', async () => {
      const { result } = run(await makePng(4, 4), 'png', 'jpeg', {
        options: { width: 100, height: 100 },
      });

      await expect(result).resolves.toMatchObject({
        ok: true,
        width: 4,
        height: 4,
      });
    });

    it('SVG -> PNG at the intrinsic size', async () => {
      const { result, outputPath } = run(makeSvg(), 'svg', 'png');

      await expect(result).resolves.toMatchObject({
        ok: true,
        width: 20,
        height: 10,
      });
      expect(await firstPixel(await readFile(outputPath))).toEqual([
        255, 0, 0, 255,
      ]);
    });

    it('SVG -> PNG with width/height applied', async () => {
      const { result } = run(makeSvg(), 'svg', 'png', {
        options: { width: 33, height: 44 },
      });

      await expect(result).resolves.toMatchObject({ width: 33, height: 44 });
    });

    it('SVG -> JPEG with only a height keeps the aspect ratio', async () => {
      const { result, outputPath } = run(makeSvg(), 'svg', 'jpeg', {
        options: { height: 30 },
      });

      await expect(result).resolves.toMatchObject({ width: 60, height: 30 });
      expect((await sharp(outputPath).metadata()).format).toBe('jpeg');
    });

    it('SVG without intrinsic size defaults to 1024x1024', async () => {
      const { result } = run(makeSvg('', '<rect/>'), 'svg', 'png');

      await expect(result).resolves.toMatchObject({
        width: 1024,
        height: 1024,
      });
    });

    it('SVG -> JPEG flattens transparency onto the requested background', async () => {
      const transparentSvg = makeSvg('width="4" height="4"', '');
      const { result, outputPath } = run(transparentSvg, 'svg', 'jpeg', {
        options: { background: '#0000ff' },
      });

      await expect(result).resolves.toMatchObject({ ok: true });

      const [r, g, b] = await firstPixel(await readFile(outputPath));

      expect(r).toBeLessThan(10);
      expect(g).toBeLessThan(10);
      expect(b).toBeGreaterThan(245);
    });

    it('SVG -> PNG paints the background behind transparent areas', async () => {
      const { result, outputPath } = run(
        makeSvg('width="4" height="4"', ''),
        'svg',
        'png',
        { options: { background: '#00ff00' } },
      );

      await expect(result).resolves.toMatchObject({ ok: true });
      expect(await firstPixel(await readFile(outputPath))).toEqual([
        0, 255, 0, 255,
      ]);
    });
  });

  describe('error codes', () => {
    it('VECTORIZATION_NOT_SUPPORTED for a raster -> svg task', async () => {
      await expect(
        run(await makePng(), 'png', 'svg').result,
      ).resolves.toMatchObject({
        ok: false,
        code: 'VECTORIZATION_NOT_SUPPORTED',
      });
    });

    it('UNSUPPORTED_DIRECTION for a same-format task', async () => {
      await expect(
        run(await makeJpeg(), 'jpeg', 'jpeg').result,
      ).resolves.toMatchObject({ ok: false, code: 'UNSUPPORTED_DIRECTION' });
    });

    it('INVALID_IMAGE for a corrupt header', async () => {
      await expect(
        run(Buffer.from('garbage'), 'png', 'jpeg').result,
      ).resolves.toEqual({
        ok: false,
        code: 'INVALID_IMAGE',
        message: 'Image data is corrupted',
      });
    });

    it('INVALID_IMAGE for data that fails while decoding', async () => {
      await expect(
        run(await makeTruncatedPng(), 'png', 'jpeg').result,
      ).resolves.toEqual({
        ok: false,
        code: 'INVALID_IMAGE',
        message: 'Image data is invalid or corrupted',
      });
    });

    it('EXCEEDED_MAX_PIXELS from raster header dimensions', async () => {
      await expect(
        run(makePngHeader(100_000, 100_000), 'png', 'jpeg', {
          limits: { maxInputPixels: 50_000_000 },
        }).result,
      ).resolves.toMatchObject({ ok: false, code: 'EXCEEDED_MAX_PIXELS' });
    });

    it('EXCEEDED_MAX_PIXELS from the sharp pixel limit while rendering', async () => {
      await expect(
        run(makeSvg('width="100" height="100"'), 'svg', 'png', {
          limits: { maxInputPixels: 100 },
        }).result,
      ).resolves.toEqual({
        ok: false,
        code: 'EXCEEDED_MAX_PIXELS',
        message: 'Image exceeds the pixel limit',
      });
    });

    it('EXCEEDED_MAX_DIMENSIONS for an SVG rasterized above the caps', async () => {
      await expect(
        run(makeSvg('width="5000" height="10"'), 'svg', 'png').result,
      ).resolves.toMatchObject({ ok: false, code: 'EXCEEDED_MAX_DIMENSIONS' });
      await expect(
        run(makeSvg(), 'svg', 'jpeg', {
          options: { height: 11 },
          limits: { maxRasterHeight: 10 },
        }).result,
      ).resolves.toMatchObject({ ok: false, code: 'EXCEEDED_MAX_DIMENSIONS' });
    });

    it('SVG_SANITY_FAILED for malformed SVG', async () => {
      await expect(
        run(Buffer.from('<svg><rect></svg>'), 'svg', 'png').result,
      ).resolves.toMatchObject({ ok: false, code: 'SVG_SANITY_FAILED' });
    });

    it('INTERNAL for a system error (missing input file)', async () => {
      // fs errors come from another realm under jest, so only the code is
      // asserted here; the message branch is covered below.
      await expect(run(null, 'png', 'jpeg').result).resolves.toMatchObject({
        ok: false,
        code: 'INTERNAL',
      });
    });

    it('INTERNAL for an Error carrying a system code, exposing only its name', async () => {
      const { task, result } = run(makeSvg(), 'svg', 'png');

      // Settle the helper's own conversion so it cannot write after teardown.
      await result;
      const options = {
        quality: 85,
        background: '#fff',
        get width(): number {
          throw Object.assign(new Error('secret path /etc/x'), {
            code: 'EACCES',
          });
        },
      };

      await expect(convertImage({ ...task, options })).resolves.toEqual({
        ok: false,
        code: 'INTERNAL',
        message: 'Error',
      });
    });

    it('INTERNAL for a non-Error throw', async () => {
      const { task, result } = run(makeSvg(), 'svg', 'png');

      // Settle the helper's own conversion so it cannot write after teardown.
      await result;
      const options = {
        quality: 85,
        background: '#fff',
        get width(): number {
          throw 'not an error';
        },
      };

      await expect(convertImage({ ...task, options })).resolves.toEqual({
        ok: false,
        code: 'INTERNAL',
        message: 'Unknown error',
      });
    });
  });
});
