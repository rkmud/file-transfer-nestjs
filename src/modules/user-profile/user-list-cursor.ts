import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  SORT_ORDERS,
  SortOrder,
  USER_LIST_SORTS,
  UserListKey,
  UserListSort,
} from '@/modules/users/users.types';

interface CursorPayload {
  s: UserListSort;
  o: SortOrder;
  v: string | null;
  id: string;
}

const TIMESTAMP_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const EMAIL_VALUE_MAX_LENGTH = 320;

export function encodeUserListCursor(
  sort: UserListSort,
  order: SortOrder,
  key: UserListKey,
): string {
  const payload: CursorPayload = {
    s: sort,
    o: order,
    v: key.value,
    id: key.id,
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeUserListCursor(
  cursor: string,
  sort: UserListSort,
  order: SortOrder,
): UserListKey {
  const payload = parse(cursor);

  if (!payload) {
    throw new BadRequestException('Malformed cursor');
  }

  if (payload.s !== sort || payload.o !== order) {
    throw new BadRequestException(
      'Cursor does not match the requested sort/order',
    );
  }

  return { value: payload.v, id: payload.id };
}

function parse(cursor: string): CursorPayload | null {
  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const { s, o, v, id } = payload as Record<string, unknown>;

  if (
    !USER_LIST_SORTS.includes(s as UserListSort) ||
    !SORT_ORDERS.includes(o as SortOrder) ||
    typeof id !== 'string' ||
    !isUUID(id)
  ) {
    return null;
  }

  return isValidValue(s as UserListSort, v)
    ? { s: s as UserListSort, o: o as SortOrder, v, id }
    : null;
}

function isValidValue(
  sort: UserListSort,
  value: unknown,
): value is string | null {
  switch (sort) {
    case 'email':
      return (
        typeof value === 'string' && value.length <= EMAIL_VALUE_MAX_LENGTH
      );
    case 'created_at':
      return isTimestamp(value);
    case 'last_login':
      return value === null || isTimestamp(value);
  }
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    TIMESTAMP_VALUE_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
