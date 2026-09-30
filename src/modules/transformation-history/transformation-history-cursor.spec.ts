import { BadRequestException } from '@nestjs/common';
import {
  decodeTransformationHistoryCursor,
  encodeTransformationHistoryCursor,
} from './transformation-history-cursor';

const ID = '00000000-0000-4000-8000-000000000001';
const encodeRaw = (value: unknown): string =>
  Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value),
  ).toString('base64url');

describe('transformation history cursor', () => {
  it('encodes Base64URL JSON { createdAt, id } and drops extra keys', () => {
    const cursor = encodeTransformationHistoryCursor({
      createdAt: '2026-01-15T10:00:00.123456Z',
      id: ID,
      extra: 'x',
    } as never);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toEqual({
      createdAt: '2026-01-15T10:00:00.123456Z',
      id: ID,
    });
  });

  it.each([
    '2026-01-15T10:00:00.123456Z',
    '2026-01-15T10:00:00.1Z',
    '2026-01-15T10:00:00Z',
  ])('round-trips %s exactly (microsecond precision)', (createdAt) => {
    expect(
      decodeTransformationHistoryCursor(
        encodeTransformationHistoryCursor({ createdAt, id: ID }),
      ),
    ).toEqual({ createdAt, id: ID });
  });

  it.each([
    ['non-JSON payload', encodeRaw('not json')],
    ['JSON null', encodeRaw('null')],
    ['JSON number', encodeRaw('42')],
    ['missing createdAt', encodeRaw({ id: ID })],
    ['numeric createdAt', encodeRaw({ createdAt: 1, id: ID })],
    [
      'non-UTC timestamp',
      encodeRaw({ createdAt: '2026-01-15T10:00:00+01:00', id: ID }),
    ],
    [
      'too many fraction digits',
      encodeRaw({ createdAt: '2026-01-15T10:00:00.1234567Z', id: ID }),
    ],
    [
      'impossible date',
      encodeRaw({ createdAt: '2026-13-45T10:00:00Z', id: ID }),
    ],
    [
      'non-UUID id',
      encodeRaw({ createdAt: '2026-01-15T10:00:00Z', id: 'abc' }),
    ],
    ['numeric id', encodeRaw({ createdAt: '2026-01-15T10:00:00Z', id: 7 })],
  ])('rejects a %s with 400', (_label, cursor) => {
    expect(() => decodeTransformationHistoryCursor(cursor)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a tampered cursor with 400', () => {
    const cursor = encodeTransformationHistoryCursor({
      createdAt: '2026-01-15T10:00:00Z',
      id: ID,
    });

    expect(() =>
      decodeTransformationHistoryCursor(`${cursor.slice(0, -4)}!!!!`),
    ).toThrow('Malformed cursor');
  });
});
