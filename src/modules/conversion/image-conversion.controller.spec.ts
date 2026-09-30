import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { ImageConversionController } from './image-conversion.controller';
import { ImageConversionService } from './services/image-conversion.service';

describe('ImageConversionController', () => {
  const service = {
    getSupportedFormats: jest.fn(),
    convert: jest.fn(),
  };
  const controller = new ImageConversionController(
    service as unknown as ImageConversionService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('returns the supported directions from the service', () => {
    const directions = [{ source: 'png', target: ['jpeg'] }];

    service.getSupportedFormats.mockReturnValue(directions);

    expect(controller.getFormats()).toBe(directions);
  });

  it('passes the user, file and options to the service and streams the result', async () => {
    const stream = Readable.from([Buffer.from('x')]);
    const file = { path: '/tmp/upload' } as Express.Multer.File;

    service.convert.mockResolvedValue({
      stream,
      mimeType: 'image/png',
      fileName: 'converted.png',
      size: 1,
    });

    const result = await controller.convert(
      { sub: 'user-1' } as TokenPayload,
      { targetFormat: 'png', quality: 50, width: 10, save: true },
      file,
    );

    expect(service.convert).toHaveBeenCalledWith({
      userId: 'user-1',
      file,
      targetFormat: 'png',
      quality: 50,
      width: 10,
      save: true,
    });
    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getStream()).toBe(stream);
    expect(result.getHeaders()).toEqual({
      type: 'image/png',
      disposition: 'attachment; filename="converted.png"',
      length: 1,
    });
  });
});
