import { Readable } from 'stream';

export const TRANSFORMATION_TYPES = ['file', 'image'] as const;
export const TRANSFORMATION_STATUSES = ['success', 'error'] as const;
export const TRANSFORMATION_FORMATS = [
  'csv',
  'json',
  'xml',
  'yaml',
  'png',
  'jpeg',
  'svg',
] as const;

export type TransformationType = (typeof TRANSFORMATION_TYPES)[number];
export type TransformationStatus = (typeof TRANSFORMATION_STATUSES)[number];
export type TransformationFormat = (typeof TRANSFORMATION_FORMATS)[number];

export interface TransformationLogInput {
  id: string;
  userId: string;
  type: TransformationType;
  sourceFormat: string | null;
  targetFormat: string;
  status: TransformationStatus;
  errorCode: string | null;
  fileSize: number;
  durationMs: number;
  sourceFilePath: string | null;
  targetFilePath: string | null;
  createdAt: Date;
}

export interface TransformationHistoryCursorKey {
  createdAt: string;
  id: string;
}

export interface TransformationHistoryFilter {
  userId?: string;
  type?: TransformationType;
  sourceFormat?: TransformationFormat;
  targetFormat?: TransformationFormat;
  status?: TransformationStatus;
  createdAtFrom?: Date;
  createdAtTo?: Date;
}

export interface TransformationHistoryItem {
  id: string;
  userId: string;
  type: TransformationType;
  sourceFormat: string;
  targetFormat: string;
  status: TransformationStatus;
  fileSize: number;
  durationMs: number;
  errorCode: string | null;
  isStored: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface TransformationOutputInput {
  id: string;
  userId: string;
  targetFormat: string;
  extension: string;
  createdAt: Date;
  open: () => Readable;
}

export interface TransformationDownload {
  stream: Readable;
  mimeType: string;
  fileName: string;
  size: number;
}

export interface TransformationPurgeResult {
  purgedFilesCount: number;
  freedSpaceBytes: number;
  failedCount: number;
}

export interface TransformationHistoryPageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface TransformationHistoryPage {
  items: TransformationHistoryItem[];
  pageInfo: TransformationHistoryPageInfo;
}
