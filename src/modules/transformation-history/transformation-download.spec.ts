import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import {
  TRANSFORMATION_DOWNLOAD_PRODUCES,
  toDownloadFile,
} from './transformation-download';

describe('transformation download helpers', () => {
  it('lists every distinct MIME type without parameters', () => {
    expect(TRANSFORMATION_DOWNLOAD_PRODUCES).toEqual([
      'text/csv',
      'application/json',
      'application/xml',
      'application/yaml',
      'image/png',
      'image/jpeg',
      'image/svg+xml',
    ]);
  });

  it('wraps the download as an attachment StreamableFile', () => {
    const stream = Readable.from(['x']);
    const file = toDownloadFile({
      stream,
      mimeType: 'image/png',
      fileName: 'transformed_1.png',
      size: 1,
    });

    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getStream()).toBe(stream);
    expect(file.getHeaders()).toEqual({
      type: 'image/png',
      disposition: 'attachment; filename="transformed_1.png"',
      length: 1,
    });
  });
});
