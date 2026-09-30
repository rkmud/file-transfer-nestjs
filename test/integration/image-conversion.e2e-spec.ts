import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import request from 'supertest';
import {
  Conversion,
  ConversionStatus,
  ConversionType,
} from '@/modules/conversion/entities/conversion.entity';
import { ConversionStorage } from '@/modules/conversion/services/conversion-storage.service';
import { ConversionTimeoutError } from '@/modules/conversion/services/worker-pool';
import { User } from '@/modules/users/users.entity';
import { createTestApp, TestApp } from '../setup';
import {
  firstPixel,
  makeJpeg,
  makeNoisyPng,
  makePng,
  makePngHeader,
  makeSvg,
} from '../setup/image-fixtures';

const PNG_MAX_SIZE = 4096;

const binaryParser = (
  res: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];

  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('Image conversion (010) — /api/images/convert', () => {
  let t: TestApp;
  let user: User;
  let cookie: string;
  let png: Buffer;
  let transparentPng: Buffer;
  let jpeg: Buffer;
  const svg = makeSvg('width="20" height="10"');

  beforeAll(async () => {
    t = await createTestApp({
      env: { PNG_MAX_SIZE: String(PNG_MAX_SIZE), MAX_RASTER_WIDTH: '2048' },
    });
    png = await makePng(8, 8);
    transparentPng = await makePng(4, 4, { r: 0, g: 0, b: 0, alpha: 0 });
    jpeg = await makeJpeg(6, 4);
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    user = await t.seedUser();
    cookie = t.authCookie(user);
  });

  const convert = (
    file: Buffer,
    filename: string,
    contentType: string,
    fields: Record<string, string>,
    authCookie: string | null = cookie,
  ) => {
    let req = t.http().post('/api/images/convert');

    if (authCookie) req = req.set('Cookie', authCookie);
    for (const [key, value] of Object.entries(fields)) {
      req = req.field(key, value);
    }

    return req
      .attach('file', file, { filename, contentType })
      .buffer(true)
      .parse(binaryParser);
  };

  const jsonBody = (res: request.Response): Record<string, unknown> =>
    JSON.parse((res.body as Buffer).toString('utf8')) as Record<
      string,
      unknown
    >;

  const conversions = () => t.db.repo(Conversion).all();

  const incomingFiles = () => {
    const dir = join(t.dirs.conversions, 'incoming');

    return existsSync(dir) ? readdirSync(dir) : [];
  };

  const incomingFilesAfterCleanup = async (): Promise<string[]> => {
    for (let i = 0; i < 100 && incomingFiles().length > 0; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    return incomingFiles();
  };

  describe('GET /api/images/convert/formats', () => {
    it('lists the allowed directions', async () => {
      const res = await t
        .http()
        .get('/api/images/convert/formats')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body).toEqual([
        { source: 'png', target: ['jpeg'] },
        { source: 'jpeg', target: ['png'] },
        { source: 'svg', target: ['png', 'jpeg'] },
      ]);
    });

    it('returns 401 without a cookie', async () => {
      await t.http().get('/api/images/convert/formats').expect(401);
    });

    it('returns 401 for an invalid token and for a refresh token', async () => {
      await t
        .http()
        .get('/api/images/convert/formats')
        .set('Cookie', 'access_token=not-a-jwt')
        .expect(401);
      await t
        .http()
        .get('/api/images/convert/formats')
        .set('Cookie', `access_token=${t.refreshToken(user)}`)
        .expect(401);
    });
  });

  describe('POST /api/images/convert — allowed directions', () => {
    it('PNG -> JPEG: 200, image/jpeg attachment, transparency flattened to white', async () => {
      const res = await convert(transparentPng, 'a.png', 'image/png', {
        targetFormat: 'jpeg',
        quality: '90',
      }).expect(200);

      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="converted.jpg"',
      );

      const body = res.body as Buffer;

      expect(Number(res.headers['content-length'])).toBe(body.length);
      expect((await sharp(body).metadata()).format).toBe('jpeg');
      (await firstPixel(body)).forEach((channel) =>
        expect(channel).toBeGreaterThan(245),
      );

      const [row] = conversions();

      expect(row).toMatchObject({
        userId: user.id,
        type: ConversionType.Image,
        status: ConversionStatus.Success,
        inputFormat: 'png',
        outputFormat: 'jpeg',
        inputFileName: 'a.png',
        outputSize: body.length,
        errorCode: null,
        errorReason: null,
      });
      expect(await incomingFilesAfterCleanup()).toEqual([]);
    });

    it('JPEG -> PNG: 200, image/png', async () => {
      const res = await convert(jpeg, 'photo.jpg', 'image/jpeg', {
        targetFormat: 'png',
      }).expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="converted.png"',
      );

      const meta = await sharp(res.body as Buffer).metadata();

      expect([meta.format, meta.width, meta.height]).toEqual(['png', 6, 4]);
    });

    it('SVG -> PNG: 200, image/png at the requested size and background', async () => {
      const res = await convert(
        makeSvg('width="20" height="10"', ''),
        'drawing.svg',
        'image/svg+xml',
        { targetFormat: 'png', width: '40', background: '#0000ff' },
      ).expect(200);

      expect(res.headers['content-type']).toBe('image/png');

      const body = res.body as Buffer;
      const meta = await sharp(body).metadata();

      expect([meta.width, meta.height]).toEqual([40, 20]);
      expect(await firstPixel(body)).toEqual([0, 0, 255, 255]);
    });

    it('SVG -> JPEG: 200, image/jpeg', async () => {
      const res = await convert(svg, 'drawing.svg', 'image/svg+xml', {
        targetFormat: 'JPEG',
        height: '5',
      }).expect(200);

      expect(res.headers['content-type']).toBe('image/jpeg');

      const meta = await sharp(res.body as Buffer).metadata();

      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 10, 5]);
      expect(conversions()[0]).toMatchObject({
        type: ConversionType.Image,
        inputFormat: 'svg',
        outputFormat: 'jpeg',
      });
    });
  });

  describe('POST /api/images/convert — failures', () => {
    const expectFailure = async (
      res: request.Response,
      status: number,
      code: string,
    ) => {
      expect(res.status).toBe(status);
      expect(jsonBody(res)).toMatchObject({ statusCode: status, code });

      const [row] = conversions();

      expect(row).toMatchObject({
        type: ConversionType.Image,
        status: ConversionStatus.Error,
        errorCode: status,
        errorReason: code,
        outputPath: null,
      });
      expect(await incomingFilesAfterCleanup()).toEqual([]);
    };

    it.each([
      ['png', () => png, 'a.png', 'image/png'],
      ['jpeg', () => jpeg, 'a.jpg', 'image/jpeg'],
    ])(
      'target svg from %s -> 400 VECTORIZATION_NOT_SUPPORTED',
      async (_source, file, name, mime) => {
        const res = await convert(file(), name, mime, { targetFormat: 'svg' });

        await expectFailure(res, 400, 'VECTORIZATION_NOT_SUPPORTED');
        expect(t.imagePool.run).not.toHaveBeenCalled();
      },
    );

    it('same-format target -> 400 UNSUPPORTED_DIRECTION', async () => {
      const res = await convert(png, 'a.png', 'image/png', {
        targetFormat: 'png',
      });

      await expectFailure(res, 400, 'UNSUPPORTED_DIRECTION');
    });

    it('corrupt image -> 400 INVALID_IMAGE', async () => {
      const corrupt = Buffer.concat([png.subarray(0, 8), Buffer.alloc(64, 7)]);
      const res = await convert(corrupt, 'broken.png', 'image/png', {
        targetFormat: 'jpeg',
      });

      await expectFailure(res, 400, 'INVALID_IMAGE');
      expect(conversions()[0].inputFormat).toBe('png');
    });

    it('oversized input -> 413 FILE_TOO_LARGE', async () => {
      const big = await makeNoisyPng();

      expect(big.length).toBeGreaterThan(PNG_MAX_SIZE);

      const res = await convert(big, 'big.png', 'image/png', {
        targetFormat: 'jpeg',
      });

      await expectFailure(res, 413, 'FILE_TOO_LARGE');
      expect(t.imagePool.run).not.toHaveBeenCalled();
    });

    it.each([
      ['signature vs extension', () => png, 'photo.jpg', 'image/jpeg'],
      ['signature vs MIME type', () => png, 'photo.png', 'image/jpeg'],
      ['unknown extension', () => png, 'photo.gif', 'image/gif'],
      [
        'unknown signature',
        () => Buffer.from('GIF89a....'),
        'a.png',
        'image/png',
      ],
    ])(
      'mismatched %s -> 415 UNSUPPORTED_FORMAT',
      async (_label, file, name, mime) => {
        const res = await convert(file(), name, mime, { targetFormat: 'jpeg' });

        await expectFailure(res, 415, 'UNSUPPORTED_FORMAT');
        expect(conversions()[0].inputFormat).toBeNull();
      },
    );

    it('unsafe/malformed SVG -> 400 SVG_SANITY_FAILED', async () => {
      const res = await convert(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
        'a.svg',
        'image/svg+xml',
        { targetFormat: 'png' },
      );

      await expectFailure(res, 400, 'SVG_SANITY_FAILED');
    });

    it('SVG rasterized above MAX_RASTER_* -> 400 EXCEEDED_MAX_DIMENSIONS', async () => {
      const res = await convert(svg, 'a.svg', 'image/svg+xml', {
        targetFormat: 'png',
        width: '2049',
      });

      await expectFailure(res, 400, 'EXCEEDED_MAX_DIMENSIONS');
      expect(t.imagePool.run).not.toHaveBeenCalled();
    });

    it('pixel bomb header -> 400 EXCEEDED_MAX_PIXELS', async () => {
      const res = await convert(
        makePngHeader(100_000, 100_000),
        'bomb.png',
        'image/png',
        { targetFormat: 'jpeg' },
      );

      await expectFailure(res, 400, 'EXCEEDED_MAX_PIXELS');
    });

    it('worker timeout -> 408, conversion row with TIMEOUT', async () => {
      const lingering = jest
        .spyOn(t.get<ConversionStorage>(ConversionStorage), 'removeLingering')
        .mockResolvedValue(undefined);

      t.imagePool.run.mockRejectedValueOnce(new ConversionTimeoutError());

      try {
        const res = await convert(png, 'a.png', 'image/png', {
          targetFormat: 'jpeg',
        });

        expect(res.status).toBe(408);
        expect(conversions()[0]).toMatchObject({
          type: ConversionType.Image,
          status: ConversionStatus.Error,
          errorCode: 408,
          errorReason: 'TIMEOUT',
        });
        expect(lingering).toHaveBeenCalledWith(
          expect.stringMatching(/\.jpg\.part$/),
        );
      } finally {
        lingering.mockRestore();
      }
    });

    it('missing file -> 400 without a conversion row', async () => {
      const res = await t
        .http()
        .post('/api/images/convert')
        .set('Cookie', cookie)
        .field('targetFormat', 'jpeg')
        .expect(400);

      expect(res.body).toMatchObject({ statusCode: 400 });
      expect(conversions()).toHaveLength(0);
    });

    it.each([
      [{ targetFormat: 'gif' }],
      [{ targetFormat: 'jpeg', quality: '0' }],
      [{ targetFormat: 'jpeg', quality: '101' }],
      [{ targetFormat: 'png', width: '0' }],
      [{ targetFormat: 'png', height: 'abc' }],
      [{ targetFormat: 'png', background: 'red' }],
    ])('invalid parameters %j -> 400 from validation', async (fields) => {
      const res = await convert(svg, 'a.svg', 'image/svg+xml', fields);

      expect(res.status).toBe(400);
      expect(conversions()).toHaveLength(0);
      expect(await incomingFilesAfterCleanup()).toEqual([]);
    });

    it('returns 401 without a cookie and creates no row', async () => {
      const res = await convert(
        png,
        'a.png',
        'image/png',
        { targetFormat: 'jpeg' },
        null,
      );

      expect(res.status).toBe(401);
      expect(conversions()).toHaveLength(0);
    });

    it('returns 401 for a refresh token used as access token', async () => {
      const res = await convert(
        png,
        'a.png',
        'image/png',
        { targetFormat: 'jpeg' },
        `access_token=${t.refreshToken(user)}`,
      );

      expect(res.status).toBe(401);
    });
  });
});
