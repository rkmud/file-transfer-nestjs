import { RBAC_ACTION_SEPARATOR } from '@/modules/rbac/rbac.constants';
import { TransformationFormat } from './transformation-history.types';

export const TRANSFORMATIONS_HISTORY_PERMISSION = 'transformations.history';
export const TRANSFORMATIONS_HISTORY_ADMIN_ACTION = 'admin';

export const TRANSFORMATIONS_HISTORY_ADMIN_PERMISSION = `${TRANSFORMATIONS_HISTORY_PERMISSION}${RBAC_ACTION_SEPARATOR}${TRANSFORMATIONS_HISTORY_ADMIN_ACTION}`;

export const TRANSFORMATION_HISTORY_DEFAULT_LIMIT = 20;
export const TRANSFORMATION_HISTORY_MAX_LIMIT = 100;
export const TRANSFORMATION_HISTORY_CURSOR_MAX_LENGTH = 512;

export const TRANSFORMATION_UNKNOWN_FORMAT = 'unknown';

export const TRANSFORMATION_DOWNLOAD_FILE_PREFIX = 'transformed_';

export const TRANSFORMATION_MIME_TYPES: Record<TransformationFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
  png: 'image/png',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
};

export const TRANSFORMATION_FALLBACK_MIME_TYPE = 'application/octet-stream';

export const TRANSFORMATION_STORAGE_PURGE_BATCH_SIZE = 500;
export const TRANSFORMATION_STORAGE_CLEANUP_JOB =
  'transformation-storage-cleanup';

export const TRANSFORMATION_STORAGE_ERROR_FULL = 'STORAGE_FULL';
export const TRANSFORMATION_STORAGE_ERROR_WRITE = 'STORAGE_WRITE_FAILED';
