import { BadRequestException } from '@nestjs/common';
import { decodeUserListCursor, encodeUserListCursor } from './user-list-cursor';

const ID = '00000000-0000-4000-8000-000000000001';
const TS = '2026-01-15T10:00:00.123456Z';

const raw = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

describe('user list cursor', () => {
  it.each([
    ['created_at', 'desc', TS],
    ['last_login', 'asc', TS],
    ['last_login', 'desc', null],
    ['email', 'asc', 'a@example.com'],
  ] as const)('round-trips %s/%s', (sort, order, value) => {
    const cursor = encodeUserListCursor(sort, order, { value, id: ID });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeUserListCursor(cursor, sort, order)).toEqual({
      value,
      id: ID,
    });
  });

  it('rejects a cursor used with a different sort or order', () => {
    const cursor = encodeUserListCursor('email', 'asc', {
      value: 'a@example.com',
      id: ID,
    });

    expect(() => decodeUserListCursor(cursor, 'created_at', 'asc')).toThrow(
      'Cursor does not match the requested sort/order',
    );
    expect(() => decodeUserListCursor(cursor, 'email', 'desc')).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['not base64 json', '%%%'],
    ['json null', raw(null)],
    ['json number', raw(42)],
    ['unknown sort', raw({ s: 'name', o: 'asc', v: 'x', id: ID })],
    ['unknown order', raw({ s: 'email', o: 'up', v: 'x', id: ID })],
    ['missing id', raw({ s: 'email', o: 'asc', v: 'x' })],
    ['non-uuid id', raw({ s: 'email', o: 'asc', v: 'x', id: 'nope' })],
    ['non-string email', raw({ s: 'email', o: 'asc', v: 1, id: ID })],
    [
      'too long email',
      raw({ s: 'email', o: 'asc', v: 'a'.repeat(321), id: ID }),
    ],
    ['null created_at', raw({ s: 'created_at', o: 'asc', v: null, id: ID })],
    [
      'millisecond created_at',
      raw({ s: 'created_at', o: 'asc', v: '2026-01-15T10:00:00.123Z', id: ID }),
    ],
    [
      'impossible date',
      raw({
        s: 'last_login',
        o: 'asc',
        v: '2026-13-45T10:00:00.123456Z',
        id: ID,
      }),
    ],
    ['numeric last_login', raw({ s: 'last_login', o: 'asc', v: 5, id: ID })],
  ])('rejects a malformed cursor (%s)', (_name, cursor) => {
    const [sort, order] = (() => {
      try {
        const payload = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        );

        return [payload?.s ?? 'email', payload?.o ?? 'asc'];
      } catch {
        return ['email', 'asc'];
      }
    })();

    expect(() => decodeUserListCursor(cursor, sort, order)).toThrow(
      'Malformed cursor',
    );
  });
});
