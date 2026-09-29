import { StreamableFile } from '@nestjs/common';
import { TRANSFORMATION_MIME_TYPES } from './transformation-history.constants';
import { TransformationDownload } from './transformation-history.types';

export const TRANSFORMATION_DOWNLOAD_PRODUCES = [
  ...new Set(
    Object.values(TRANSFORMATION_MIME_TYPES).map((type) => type.split(';')[0]),
  ),
];

export const toDownloadFile = ({
  stream,
  mimeType,
  fileName,
  size,
}: TransformationDownload): StreamableFile =>
  new StreamableFile(stream, {
    type: mimeType,
    disposition: `attachment; filename="${fileName}"`,
    length: size,
  });
