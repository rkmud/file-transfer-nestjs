import { TransformationLogInput } from '@/modules/transformation-history/transformation-history.types';
import {
  CONVERSION_FALLBACK_FILE_NAME,
  CONVERSION_FILE_NAME_MAX_LENGTH,
} from './conversion.constants';
import { Conversion, ConversionStatus } from './entities/conversion.entity';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export const sanitizeFileName = (name: string | undefined): string => {
  const base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .trim();

  if (base === '' || base === '.' || base === '..') {
    return CONVERSION_FALLBACK_FILE_NAME;
  }

  if (base.length <= CONVERSION_FILE_NAME_MAX_LENGTH) {
    return base;
  }

  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot, dot + 16) : '';

  return (
    base.slice(0, CONVERSION_FILE_NAME_MAX_LENGTH - extension.length) +
    extension
  );
};

export const toTransformationLog = (
  record: Conversion,
): TransformationLogInput => ({
  id: record.id,
  userId: record.userId,
  type: record.type,
  sourceFormat: record.inputFormat,
  targetFormat: record.outputFormat,
  status: record.status === ConversionStatus.Success ? 'success' : 'error',
  errorCode:
    record.status === ConversionStatus.Success ? null : record.errorReason,
  fileSize: record.inputSize,
  durationMs: record.durationMs ?? 0,
  sourceFilePath: record.inputPath,
  targetFilePath: record.outputPath,
  createdAt: record.createdAt,
});
