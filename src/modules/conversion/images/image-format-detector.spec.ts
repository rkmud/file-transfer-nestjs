import { detectImageFormat } from './image-format-detector';
import { createImageFormatRegistry } from './image-format-registry';
import { ImageConversionError } from './image-conversion-error';
import {
  makeJpeg,
  makePng,
  makeSvg,
} from '../../../../test/setup/image-fixtures';

describe('detectImageFormat', () => {
  const registry = createImageFormatRegistry();
  let png: Buffer;
  let jpeg: Buffer;
  const svg = makeSvg();

  beforeAll(async () => {
    png = await makePng();
    jpeg = await makeJpeg();
  });

  const expectUnsupported = (fn: () => unknown, message: RegExp) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(ImageConversionError);
      expect((error as ImageConversionError).code).toBe('UNSUPPORTED_FORMAT');
      expect((error as Error).message).toMatch(message);
      return;
    }
    throw new Error('expected UNSUPPORTED_FORMAT');
  };

  it.each([
    ['png', 'a.png', 'image/png', () => png],
    ['jpeg', 'a.jpg', 'image/jpeg', () => jpeg],
    ['jpeg', 'a.JPEG', 'image/pjpeg', () => jpeg],
    ['jpeg', 'a.jpeg', 'image/jpg', () => jpeg],
    ['svg', 'a.svg', 'image/svg+xml', () => svg],
    ['svg', 'a.svg', 'text/xml; charset=utf-8', () => svg],
    ['svg', 'a.svg', 'application/xml', () => svg],
  ])(
    'detects %s from signature, extension and MIME (%s, %s)',
    (format, name, mime, head) => {
      expect(detectImageFormat(registry, name, mime, head()).format).toBe(
        format,
      );
    },
  );

  it('decides by signature when extension and MIME are generic', () => {
    expect(detectImageFormat(registry, 'upload', undefined, png).format).toBe(
      'png',
    );
    expect(
      detectImageFormat(registry, 'upload', 'application/octet-stream', jpeg)
        .format,
    ).toBe('jpeg');
    expect(detectImageFormat(registry, 'upload', '', svg).format).toBe('svg');
  });

  it('rejects an unknown signature', () => {
    expectUnsupported(
      () =>
        detectImageFormat(
          registry,
          'a.png',
          'image/png',
          Buffer.from('GIF89a...'),
        ),
      /signature/,
    );
  });

  it('rejects an extension that contradicts the signature', () => {
    expectUnsupported(
      () => detectImageFormat(registry, 'photo.jpg', 'image/jpeg', png),
      /does not match the \.jpg extension/,
    );
  });

  it('rejects an unknown extension even when the signature is valid', () => {
    expectUnsupported(
      () => detectImageFormat(registry, 'photo.gif', undefined, png),
      /Unsupported source file extension \.gif/,
    );
  });

  it('rejects a MIME type that contradicts the signature', () => {
    expectUnsupported(
      () => detectImageFormat(registry, 'photo.png', 'image/jpeg', png),
      /image\/jpeg media type/,
    );
  });
});
