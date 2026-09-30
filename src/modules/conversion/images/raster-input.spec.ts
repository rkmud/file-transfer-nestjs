import { ImageConversionError } from './image-conversion-error';
import { ImageLimits } from './image-format.types';
import { openRaster } from './raster-input';
import {
  makePng,
  makePngHeader,
  makeTruncatedPng,
} from '../../../../test/setup/image-fixtures';

const limits = (maxInputPixels: number): ImageLimits => ({
  maxInputPixels,
  maxRasterWidth: 4096,
  maxRasterHeight: 4096,
});

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(ImageConversionError);

  return (error as ImageConversionError).code;
};

describe('openRaster', () => {
  it('returns a decodable pipeline for a valid image', async () => {
    const pipeline = await openRaster(await makePng(6, 4), limits(1_000));
    const { info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

    expect([info.width, info.height]).toEqual([6, 4]);
  });

  it('accepts an image exactly at the pixel limit', async () => {
    await expect(
      openRaster(await makePng(10, 10), limits(100)),
    ).resolves.toBeDefined();
  });

  it('rejects a corrupt header with INVALID_IMAGE', async () => {
    expect(
      await codeOf(openRaster(Buffer.from('not an image'), limits(1e6))),
    ).toBe('INVALID_IMAGE');
  });

  it('rejects header dimensions above the pixel limit before decoding', async () => {
    // 100000 x 100000 in the header, only 64 bytes of pixel data: decoding
    // would fail with INVALID_IMAGE, so EXCEEDED_MAX_PIXELS proves the check
    // happens on the header alone.
    const bomb = makePngHeader(100_000, 100_000);

    expect(await codeOf(openRaster(bomb, limits(50_000_000)))).toBe(
      'EXCEEDED_MAX_PIXELS',
    );
  });

  it('uses the configured limit (EXCEEDED_MAX_PIXELS, not dimensions)', async () => {
    const error = await openRaster(await makePng(11, 10), limits(100)).catch(
      (e: ImageConversionError) => e,
    );

    expect(error).toMatchObject({
      code: 'EXCEEDED_MAX_PIXELS',
      message: 'Image exceeds the 100 pixel limit',
    });
  });

  it('defers decode errors of a readable header to the pipeline', async () => {
    const pipeline = await openRaster(await makeTruncatedPng(), limits(1e6));

    await expect(pipeline.png().toBuffer()).rejects.toThrow();
  });

  it('rejects metadata without dimensions with INVALID_IMAGE', async () => {
    let open!: typeof openRaster;

    jest.isolateModules(() => {
      jest.doMock('sharp', () => ({
        __esModule: true,
        default: () => ({ metadata: () => Promise.resolve({ width: 0 }) }),
      }));
      ({ openRaster: open } =
        jest.requireActual<typeof import('./raster-input')>('./raster-input'));
    });

    const error = await open(Buffer.alloc(1), limits(1)).catch(
      (e: ImageConversionError) => e,
    );

    expect(error).toMatchObject({
      code: 'INVALID_IMAGE',
      message: 'Image dimensions are missing',
    });
    jest.dontMock('sharp');
  });
});
