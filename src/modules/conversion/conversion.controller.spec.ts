import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import { TokenPayload } from '@/common/auth-token/auth-token.types';
import { ConversionController } from './conversion.controller';
import { ConversionService } from './services/conversion.service';

describe('ConversionController', () => {
  const service = {
    getSupportedFormats: jest.fn(),
    convert: jest.fn(),
  };
  const controller = new ConversionController(
    service as unknown as ConversionService,
  );
  const user = { sub: 'user-1', email: 'u@example.com' } as TokenPayload;

  beforeEach(() => jest.clearAllMocks());

  it('returns the supported directions from the service', () => {
    const directions = [{ source: 'csv', target: ['json'] }];

    service.getSupportedFormats.mockReturnValue(directions);

    expect(controller.getFormats()).toBe(directions);
  });

  it('delegates the conversion and wraps the result as an attachment', async () => {
    const file = { path: '/p' } as Express.Multer.File;
    const stream = Readable.from(['{}']);

    service.convert.mockResolvedValue({
      stream,
      mimeType: 'application/json; charset=utf-8',
      fileName: 'converted.json',
      size: 2,
    });

    const result = await controller.convert(
      user,
      { targetFormat: 'json', save: true },
      file,
    );

    expect(service.convert).toHaveBeenCalledWith({
      userId: 'user-1',
      file,
      targetFormat: 'json',
      save: true,
    });
    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getStream()).toBe(stream);
    expect(result.options).toEqual({
      type: 'application/json; charset=utf-8',
      disposition: 'attachment; filename="converted.json"',
      length: 2,
    });
  });
});
