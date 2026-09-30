import sharp from 'sharp';
import { crc32, deflateSync } from 'zlib';

export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const makePng = (
  width = 8,
  height = 8,
  color: { r: number; g: number; b: number; alpha?: number } = {
    r: 0,
    g: 200,
    b: 0,
    alpha: 1,
  },
): Promise<Buffer> =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { alpha: 1, ...color },
    },
  })
    .png()
    .toBuffer();

export const makeJpeg = (width = 8, height = 8): Promise<Buffer> =>
  sharp({
    create: { width, height, channels: 3, background: '#3366cc' },
  })
    .jpeg()
    .toBuffer();

export const makeNoisyPng = (width = 64, height = 64): Promise<Buffer> => {
  let state = 0x12345678;
  const pixels = Buffer.alloc(width * height * 3);

  for (let i = 0; i < pixels.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[i] = state & 0xff;
  }

  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
};

export const makeTruncatedPng = async (): Promise<Buffer> => {
  const png = await makeNoisyPng();

  return png.subarray(0, Math.floor(png.length / 2));
};

export const svgMarkup = (
  attributes = 'width="20" height="10"',
  body = '<rect width="100%" height="100%" fill="#ff0000"/>',
): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;

export const makeSvg = (attributes?: string, body?: string): Buffer =>
  Buffer.from(svgMarkup(attributes, body), 'utf8');

export const firstPixel = async (image: Buffer | string): Promise<number[]> => {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return [...data.subarray(0, info.channels)];
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
};

export const makePngHeader = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(64))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
