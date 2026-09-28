import { extname } from 'path';
import { ImageConversionError } from './image-conversion-error';
import { ImageFormatHandler } from './image-format-handler';
import { ImageFormatRegistry } from './image-format-registry';

const GENERIC_EXTENSIONS = [''];
const GENERIC_MIME_TYPES = ['', 'application/octet-stream'];

const unsupported = (message: string): never => {
  throw new ImageConversionError('UNSUPPORTED_FORMAT', message);
};

export const detectImageFormat = (
  registry: ImageFormatRegistry,
  fileName: string,
  mimeType: string | undefined,
  head: Buffer,
): ImageFormatHandler => {
  const handler =
    registry.findBySignature(head) ??
    unsupported('File signature is not a supported image format');

  const extension = extname(fileName).toLowerCase();

  if (!GENERIC_EXTENSIONS.includes(extension)) {
    const byExtension = registry.findByExtension(extension);

    if (!byExtension) {
      unsupported(`Unsupported source file extension ${extension}`);
    }

    if (byExtension !== handler) {
      unsupported(`File content does not match the ${extension} extension`);
    }
  }

  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase();

  if (!GENERIC_MIME_TYPES.includes(mime) && !handler.mimeTypes.includes(mime)) {
    unsupported(`File content does not match the ${mime} media type`);
  }

  return handler;
};
