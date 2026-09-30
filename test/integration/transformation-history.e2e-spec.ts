import sharp from 'sharp';
import { Conversion } from '@/modules/conversion/entities/conversion.entity';
import { ConversionStorage } from '@/modules/conversion/services/conversion-storage.service';
import { ConversionTimeoutError } from '@/modules/conversion/services/conversion-worker-pool.service';
import { TransformationLog } from '@/modules/transformation-history/entities/transformation-log.entity';
import { createTestApp, TestApp } from '../setup';
import { User } from '@/modules/users/users.entity';
import { transformationHistoryQueryResolver } from '../setup/transformation-history-query-resolver';

const HISTORY = '/api/transformations/history';
const ADMIN_HISTORY = '/api/admin/transformations/history';
const adminUserHistory = (userId: string) =>
  `/api/admin/users/${userId}/transformations/history`;
const MISSING_USER = '00000000-0000-4000-8000-0000000fffff';

describe('Transformation history (011)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    t.repo(TransformationLog).setQueryResolver(
      transformationHistoryQueryResolver,
    );
  });

  let minute = 0;
  const seedLog = (user: User, overrides: Partial<TransformationLog> = {}) =>
    t.repo(TransformationLog).seed({
      id: t.db.nextId(),
      userId: user.id,
      type: 'file',
      sourceFormat: 'csv',
      targetFormat: 'json',
      status: 'success',
      errorCode: null,
      fileSize: 100,
      durationMs: 5,
      sourceFilePath: null,
      targetFilePath: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, (minute += 1))),
      ...overrides,
    })[0];

  describe('GET /api/transformations/history', () => {
    it("returns only the caller's rows, newest first, in the page envelope", async () => {
      const alice = await t.seedUser();
      const bob = await t.seedUser();
      const older = seedLog(alice);
      seedLog(bob);
      const newer = seedLog(alice, {
        type: 'image',
        sourceFormat: 'png',
        targetFormat: 'jpeg',
        status: 'error',
        errorCode: 'INVALID_IMAGE',
      });

      const res = await t
        .http()
        .get(HISTORY)
        .set('Cookie', t.authCookie(alice))
        .expect(200);

      expect(res.body).toEqual({
        items: [
          {
            id: newer.id,
            userId: alice.id,
            type: 'image',
            sourceFormat: 'png',
            targetFormat: 'jpeg',
            status: 'error',
            fileSize: 100,
            durationMs: 5,
            errorCode: 'INVALID_IMAGE',
            isStored: false,
            expiresAt: null,
            createdAt: newer.createdAt.toISOString(),
          },
          expect.objectContaining({ id: older.id, userId: alice.id }),
        ],
        pageInfo: { limit: 20, hasMore: false, nextCursor: null },
      });
    });

    it('pages through nextCursor yielding every row exactly once', async () => {
      const alice = await t.seedUser();
      const ids = Array.from({ length: 7 }, () => seedLog(alice).id);
      // Two rows sharing a timestamp across the first page boundary
      // exercise the id tie-breaker of the keyset.
      const rows = t.repo(TransformationLog).all();
      const tie = rows.find((row) => row.id === ids[4])!.createdAt;
      rows.find((row) => row.id === ids[3])!.createdAt = new Date(tie);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const res: { body: any } = await t
          .http()
          .get(HISTORY)
          .query({ limit: 3, ...(cursor ? { cursor } : {}) })
          .set('Cookie', t.authCookie(alice))
          .expect(200);

        seen.push(...res.body.items.map((i: { id: string }) => i.id));
        cursor = res.body.pageInfo.nextCursor;
        pages += 1;
        expect(res.body.pageInfo.hasMore).toBe(cursor !== null);
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(7);
      expect(new Set(seen)).toEqual(new Set(ids));
    });

    it('applies filters', async () => {
      const alice = await t.seedUser();
      seedLog(alice);
      const match = seedLog(alice, {
        type: 'image',
        sourceFormat: 'svg',
        targetFormat: 'png',
        status: 'error',
      });

      const res = await t
        .http()
        .get(HISTORY)
        .query({
          type: 'IMAGE',
          sourceFormat: 'svg',
          targetFormat: 'png',
          status: 'error',
          createdAtFrom: '2026-01-01T00:00:00Z',
          createdAtTo: '2026-12-31T00:00:00Z',
        })
        .set('Cookie', t.authCookie(alice))
        .expect(200);

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        match.id,
      ]);
    });

    it.each([
      [{ limit: '0' }],
      [{ limit: '101' }],
      [{ limit: 'x' }],
      [{ type: 'video' }],
      [{ status: 'pending' }],
      [{ createdAtFrom: 'yesterday' }],
      [{ cursor: 'not-a-cursor' }],
      [
        {
          createdAtFrom: '2026-02-01T00:00:00Z',
          createdAtTo: '2026-01-01T00:00:00Z',
        },
      ],
    ])('400 for invalid query %p', async (query) => {
      const alice = await t.seedUser();

      await t
        .http()
        .get(HISTORY)
        .query(query)
        .set('Cookie', t.authCookie(alice))
        .expect(400);
    });

    it('401 without a cookie, with an invalid token, or with a refresh token', async () => {
      const alice = await t.seedUser();

      await t.http().get(HISTORY).expect(401);
      await t
        .http()
        .get(HISTORY)
        .set('Cookie', 'access_token=garbage')
        .expect(401);
      await t
        .http()
        .get(HISTORY)
        .set('Cookie', `access_token=${t.refreshToken(alice)}`)
        .expect(401);
    });
  });

  describe('admin history endpoints', () => {
    it('GET /admin/transformations/history lists every user for the admin permission', async () => {
      const admin = await t.seedAdmin();
      const alice = await t.seedUser();
      const bob = await t.seedUser();
      const a = seedLog(alice);
      const b = seedLog(bob);

      const res = await t
        .http()
        .get(ADMIN_HISTORY)
        .set('Cookie', t.authCookie(admin))
        .expect(200);

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        b.id,
        a.id,
      ]);
    });

    it('GET /admin/transformations/history?userId narrows to one user', async () => {
      const admin = await t.seedUser({
        permissions: ['transformations.history@admin'],
      });
      const alice = await t.seedUser();
      const bob = await t.seedUser();
      const a = seedLog(alice);
      seedLog(bob);

      const res = await t
        .http()
        .get(ADMIN_HISTORY)
        .query({ userId: alice.id })
        .set('Cookie', t.authCookie(admin))
        .expect(200);

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    });

    it('GET /admin/users/:userId/transformations/history lists that user', async () => {
      const admin = await t.seedAdmin();
      const alice = await t.seedUser();
      const bob = await t.seedUser();
      seedLog(alice);
      const b = seedLog(bob);

      const res = await t
        .http()
        .get(adminUserHistory(bob.id))
        .set('Cookie', t.authCookie(admin))
        .expect(200);

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);
      expect(res.body.pageInfo).toEqual({
        limit: 20,
        hasMore: false,
        nextCursor: null,
      });
    });

    it('404 for an unknown userId, 400 for a malformed one', async () => {
      const admin = await t.seedAdmin();

      await t
        .http()
        .get(adminUserHistory(MISSING_USER))
        .set('Cookie', t.authCookie(admin))
        .expect(404);
      await t
        .http()
        .get(ADMIN_HISTORY)
        .query({ userId: MISSING_USER })
        .set('Cookie', t.authCookie(admin))
        .expect(404);
      await t
        .http()
        .get(ADMIN_HISTORY)
        .query({ userId: 'nope' })
        .set('Cookie', t.authCookie(admin))
        .expect(400);
      await t
        .http()
        .get(adminUserHistory('nope'))
        .set('Cookie', t.authCookie(admin))
        .expect(400);
    });

    it.each([
      ['global', () => ADMIN_HISTORY],
      ['global with userId', () => `${ADMIN_HISTORY}?userId=${MISSING_USER}`],
      ['per user', () => adminUserHistory(MISSING_USER)],
    ])('%s: 403 without the permission, 401 anonymous', async (_l, url) => {
      const user = await t.seedUser({ permissions: ['users@read'] });

      await t.http().get(url()).set('Cookie', t.authCookie(user)).expect(403);
      await t.http().get(url()).expect(401);
      await t
        .http()
        .get(url())
        .set('Cookie', `access_token=${t.refreshToken(user)}`)
        .expect(401);
    });
  });

  describe('conversions produce history rows', () => {
    const convertCsv = (user: User, csv = 'a,b\n1,2\n', name = 'data.csv') =>
      t
        .http()
        .post('/api/convert')
        .set('Cookie', t.authCookie(user))
        .field('targetFormat', 'json')
        .attach('file', Buffer.from(csv), name);

    it('a text conversion creates exactly one row keyed by the conversion id', async () => {
      const alice = await t.seedUser();

      await convertCsv(alice).expect(200);

      const [conversion] = t.repo(Conversion).all();
      const logs = t.repo(TransformationLog).all();

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        id: conversion.id,
        userId: alice.id,
        type: 'file',
        sourceFormat: 'csv',
        targetFormat: 'json',
        status: 'success',
        errorCode: null,
        isStored: false,
      });

      const res = await t
        .http()
        .get(HISTORY)
        .set('Cookie', t.authCookie(alice))
        .expect(200);

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        conversion.id,
      ]);
    });

    it('an image conversion creates exactly one row keyed by the conversion id', async () => {
      const alice = await t.seedUser();
      const png = await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      await t
        .http()
        .post('/api/images/convert')
        .set('Cookie', t.authCookie(alice))
        .field('targetFormat', 'jpeg')
        .attach('file', png, 'pixel.png')
        .expect(200);

      const [conversion] = t.repo(Conversion).all();
      const logs = t.repo(TransformationLog).all();

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        id: conversion.id,
        type: 'image',
        sourceFormat: 'png',
        targetFormat: 'jpeg',
        status: 'success',
      });
    });

    it('a timeout is recorded with error code TIMEOUT', async () => {
      const alice = await t.seedUser();
      // The real cleanup retries on 250 ms / 1 s / 5 s timers.
      const lingering = jest
        .spyOn(t.get<ConversionStorage>(ConversionStorage), 'removeLingering')
        .mockResolvedValue(undefined);

      t.conversionPool.run.mockRejectedValueOnce(new ConversionTimeoutError());
      await convertCsv(alice).expect(408);
      expect(lingering).toHaveBeenCalled();
      lingering.mockRestore();

      expect(t.repo(TransformationLog).all()).toEqual([
        expect.objectContaining({ status: 'error', errorCode: 'TIMEOUT' }),
      ]);
    });

    it('a syntax error passes its ConversionErrorCode through', async () => {
      const alice = await t.seedUser();

      await t
        .http()
        .post('/api/convert')
        .set('Cookie', t.authCookie(alice))
        .field('targetFormat', 'yaml')
        .attach('file', Buffer.from('{"a": '), 'broken.json')
        .expect(400);

      expect(t.repo(TransformationLog).all()).toEqual([
        expect.objectContaining({
          status: 'error',
          errorCode: 'SYNTAX_ERROR',
          sourceFormat: 'json',
        }),
      ]);
    });

    it('an undetectable source is UNSUPPORTED_FORMAT with source_format unknown and no source path', async () => {
      const alice = await t.seedUser();

      await convertCsv(alice, 'whatever', 'notes.bin').expect(415);

      expect(t.repo(TransformationLog).all()).toEqual([
        expect.objectContaining({
          status: 'error',
          errorCode: 'UNSUPPORTED_FORMAT',
          sourceFormat: 'unknown',
          sourceFilePath: null,
        }),
      ]);
    });
  });
});

describe('Transformation history (011): size limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ env: { CSV_MAX_SIZE: '16' } });
  });

  afterAll(() => t.close());

  beforeEach(() => t.reset());

  it('an oversized input is recorded as FILE_TOO_LARGE', async () => {
    const alice = await t.seedUser();

    await t
      .http()
      .post('/api/convert')
      .set('Cookie', t.authCookie(alice))
      .field('targetFormat', 'json')
      .attach('file', Buffer.from('a,b\n1,2\n3,4\n5,6\n7,8\n'), 'big.csv')
      .expect(413);

    expect(t.repo(TransformationLog).all()).toEqual([
      expect.objectContaining({ status: 'error', errorCode: 'FILE_TOO_LARGE' }),
    ]);
  });
});
