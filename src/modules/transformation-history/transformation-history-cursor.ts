import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { TransformationHistoryCursorKey } from './transformation-history.types';

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function encodeTransformationHistoryCursor(
  key: TransformationHistoryCursorKey,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt: key.createdAt, id: key.id }),
  ).toString('base64url');
}

export function decodeTransformationHistoryCursor(
  cursor: string,
): TransformationHistoryCursorKey {
  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Malformed cursor');
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new BadRequestException('Malformed cursor');
  }

  const { createdAt, id } = payload as Record<string, unknown>;

  if (
    typeof createdAt !== 'string' ||
    !TIMESTAMP_PATTERN.test(createdAt) ||
    Number.isNaN(Date.parse(createdAt)) ||
    typeof id !== 'string' ||
    !isUUID(id)
  ) {
    throw new BadRequestException('Malformed cursor');
  }

  return { createdAt, id };
}
