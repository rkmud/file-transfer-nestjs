import { extname } from 'path';
import { ConversionError } from './conversion-error';
import { TextFormatHandler } from './format-handler';
import { FormatRegistry } from './format-registry';
import { FormatMatch } from './format.types';
import { decodeHead } from './text-codec';

const GENERIC_EXTENSIONS = ['', '.txt'];

export const detectSourceFormat = (
  registry: FormatRegistry,
  fileName: string,
  head: Buffer,
): TextFormatHandler => {
  const extension = extname(fileName).toLowerCase();
  const content = decodeHead(head);
  const byExtension = registry.findByExtension(extension);

  if (byExtension) {
    if (byExtension.sniff(content) === FormatMatch.No) {
      throw new ConversionError(
        'UNSUPPORTED_FORMAT',
        `File content does not match the ${extension} extension`,
      );
    }

    return byExtension;
  }

  if (!GENERIC_EXTENSIONS.includes(extension)) {
    throw new ConversionError(
      'UNSUPPORTED_FORMAT',
      `Unsupported source file extension ${extension}`,
    );
  }

  let best: TextFormatHandler | undefined;
  let bestMatch = FormatMatch.No;

  for (const handler of registry.all()) {
    const match = handler.sniff(content);

    if (match > bestMatch) {
      best = handler;
      bestMatch = match;
    }
  }

  if (!best || content === '') {
    throw new ConversionError(
      'UNSUPPORTED_FORMAT',
      'Unable to detect the source format',
    );
  }

  return best;
};
