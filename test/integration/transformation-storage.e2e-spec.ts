import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { Response } from 'supertest';
import { Conversion } from '@/modules/conversion/entities/conversion.entity';
import { TransformationLog } from '@/modules/transformation-history/entities/transformation-log.entity';
import { StorageService } from '@/modules/transformation-history/storage/storage.service';
import { TransformationFileService } from '@/modules/transformation-history/transformation-file.service';
import { TransformationStorageCleanupScheduler } from '@/modules/transformation-history/transformation-storage-cleanup.scheduler';
import { User } from '@/modules/users/users.entity';
import { createTestApp, FakeClock, TestApp, useFakeClock } from '../setup';
import { transformationHistoryQueryResolver } from '../setup/transformation-history-query-resolver';

const DAY = 24 * 60 * 60 * 1000;
const own = (itemId: string) =>
  `/api/transformations/history/${itemId}/download`;
const adminAny = (itemId: string) =>
  `/api/admin/transformations/history/${itemId}/download`;
const adminUser = (userId: string, itemId: string) =>
  `/api/admin/users/${userId}/transformations/history/${itemId}/download`;
const MISSING = '00000000-0000-4000-8000-0000000fffff';

const binary = (
  res: Response,
  cb: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];

  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Transformation storage and retention (012)', () => {
  let t: TestApp;
  let clock: FakeClock;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    clock = useFakeClock();
    await t.reset();
    t.repo(TransformationLog).setQueryResolver(
      transformationHistoryQueryResolver,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clock.restore();
  });

  /** A history row whose output was saved, with the file on disk. */
  const seedStored = (
    user: User,
    overrides: Partial<TransformationLog> = {},
    content = 'a,b\n1,2\n',
  ) => {
    const id = t.db.nextId();
    const targetFormat = overrides.targetFormat ?? 'csv';
    const storagePath = `2026-01-15/${user.id}/${id}_${targetFormat}.${targetFormat}`;
    const [log] = t.repo(TransformationLog).seed({
      id,
      userId: user.id,
      type: 'file',
      sourceFormat: 'json',
      targetFormat,
      status: 'success',
      errorCode: null,
      fileSize: content.length,
      durationMs: 3,
      sourceFilePath: null,
      targetFilePath: null,
      createdAt: clock.now(),
      isStored: true,
      storagePath,
      expiresAt: new Date(clock.now().getTime() + 90 * DAY),
      ...overrides,
    });

    if (log.storagePath) {
      const file = join(t.dirs.transformations, ...log.storagePath.split('/'));

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }

    return log;
  };

  describe('GET /api/transformations/history/:itemId/download', () => {
    it('200 streams the file as transformed_<itemId>.<ext> with its MIME type', async () => {
      const alice = await t.seedUser();
      const log = seedStored(alice);

      const res = await t
        .http()
        .get(own(log.id))
        .set('Cookie', t.authCookie(alice))
        .expect(200);

      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="transformed_${log.id}.csv"`,
      );
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-length']).toBe('8');
      expect(res.text).toBe('a,b\n1,2\n');
    });

    it('serves binary image outputs with their MIME type', async () => {
      const alice = await t.seedUser();
      const log = seedStored(
        alice,
        { type: 'image', sourceFormat: 'svg', targetFormat: 'png' },
        '\x89PNG',
      );

      const res = await t
        .http()
        .get(own(log.id))
        .set('Cookie', t.authCookie(alice))
        .buffer(true)
        .parse(binary)
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="transformed_${log.id}.png"`,
      );
      expect((res.body as Buffer).length).toBeGreaterThan(0);
    });

    it("403 for another user's item", async () => {
      const alice = await t.seedUser();
      const bob = await t.seedUser();
      const log = seedStored(alice);

      await t
        .http()
        .get(own(log.id))
        .set('Cookie', t.authCookie(bob))
        .expect(403);
    });

    it('404 for an unknown item and for an item never saved', async () => {
      const alice = await t.seedUser();
      const unsaved = seedStored(alice, {
        isStored: false,
        storagePath: null,
        expiresAt: null,
      });
      const failed = seedStored(alice, {
        isStored: false,
        storagePath: null,
        expiresAt: null,
        storageErrorCode: 'STORAGE_FULL',
      });

      for (const id of [MISSING, unsaved.id, failed.id]) {
        await t
          .http()
          .get(own(id))
          .set('Cookie', t.authCookie(alice))
          .expect(404);
      }
    });

    it('410 once expires_at has passed, even before the purge', async () => {
      const alice = await t.seedUser();
      const log = seedStored(alice);

      clock.advance(90 * DAY);

      await t
        .http()
        .get(own(log.id))
        .set('Cookie', t.authCookie(alice))
        .expect(410);
    });

    it('410 when purged or when the file is missing on disk', async () => {
      const alice = await t.seedUser();
      const purged = seedStored(alice, { isStored: false, storagePath: null });
      const missing = seedStored(alice);

      t
        .repo(TransformationLog)
        .all()
        .find((row) => row.id === missing.id)!.storagePath =
        `2026-01-15/${alice.id}/gone.csv`;

      for (const id of [purged.id, missing.id]) {
        await t
          .http()
          .get(own(id))
          .set('Cookie', t.authCookie(alice))
          .expect(410);
      }
    });

    it('400 for a non-UUID itemId', async () => {
      const alice = await t.seedUser();

      await t
        .http()
        .get(own('nope'))
        .set('Cookie', t.authCookie(alice))
        .expect(400);
    });

    it('401 anonymous, with an invalid token or a refresh token', async () => {
      const alice = await t.seedUser();
      const log = seedStored(alice);

      await t.http().get(own(log.id)).expect(401);
      await t
        .http()
        .get(own(log.id))
        .set('Cookie', 'access_token=garbage')
        .expect(401);
      await t
        .http()
        .get(own(log.id))
        .set(
          'Cookie',
          t.refreshCookie(alice).replace('refresh_token', 'access_token'),
        )
        .expect(401);
    });
  });

  describe('admin downloads', () => {
    it('GET /admin/transformations/history/:itemId/download serves any item', async () => {
      const admin = await t.seedAdmin();
      const alice = await t.seedUser();
      const log = seedStored(alice);

      const res = await t
        .http()
        .get(adminAny(log.id))
        .set('Cookie', t.authCookie(admin))
        .expect(200);

      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="transformed_${log.id}.csv"`,
      );
      expect(res.text).toBe('a,b\n1,2\n');
    });

    it('GET /admin/users/:userId/transformations/history/:itemId/download serves the owner item', async () => {
      const admin = await t.seedUser({
        permissions: ['transformations.history@admin'],
      });
      const alice = await t.seedUser();
      const log = seedStored(alice);

      await t
        .http()
        .get(adminUser(alice.id, log.id))
        .set('Cookie', t.authCookie(admin))
        .expect(200)
        .expect('Content-Type', 'text/csv; charset=utf-8');
    });

    it('404 when the item does not belong to :userId', async () => {
      const admin = await t.seedAdmin();
      const alice = await t.seedUser();
      const bob = await t.seedUser();
      const log = seedStored(alice);

      await t
        .http()
        .get(adminUser(bob.id, log.id))
        .set('Cookie', t.authCookie(admin))
        .expect(404);
    });

    it('admin still gets 404 for unsaved and 410 for expired items', async () => {
      const admin = await t.seedAdmin();
      const alice = await t.seedUser();
      const unsaved = seedStored(alice, {
        isStored: false,
        storagePath: null,
        expiresAt: null,
      });
      const expired = seedStored(alice, {
        expiresAt: new Date(clock.now().getTime() - 1),
      });

      await t
        .http()
        .get(adminAny(unsaved.id))
        .set('Cookie', t.authCookie(admin))
        .expect(404);
      await t
        .http()
        .get(adminUser(alice.id, expired.id))
        .set('Cookie', t.authCookie(admin))
        .expect(410);
    });

    it.each([
      ['global', (u: string, i: string) => (void u, adminAny(i))],
      ['per user', adminUser],
    ])('%s: 403 without the permission, 401 anonymous', async (_l, url) => {
      const alice = await t.seedUser({ permissions: ['users@read'] });
      const log = seedStored(alice);

      await t
        .http()
        .get(url(alice.id, log.id))
        .set('Cookie', t.authCookie(alice))
        .expect(403);
      await t.http().get(url(alice.id, log.id)).expect(401);
    });
  });

  describe('save=true on conversion', () => {
    const convert = (user: User, save: string) =>
      t
        .http()
        .post('/api/convert')
        .set('Cookie', t.authCookie(user))
        .field('targetFormat', 'json')
        .field('save', save)
        .attach('file', Buffer.from('a,b\n1,2\n'), 'data.csv');

    it('returns 200 while persist() is still pending', async () => {
      const alice = await t.seedUser();
      const persist = jest
        .spyOn(
          t.get<TransformationFileService>(TransformationFileService),
          'persist',
        )
        .mockReturnValue(new Promise<void>(() => undefined));

      const res = await convert(alice, 'true').expect(200);

      expect(res.body).toEqual([{ a: '1', b: '2' }]);
      const [conversion] = t.repo(Conversion).all();

      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledWith({
        id: conversion.id,
        userId: alice.id,
        targetFormat: 'json',
        extension: '.json',
        createdAt: conversion.createdAt,
        open: expect.any(Function),
      });
      // The history row exists before persist() completes, still unsaved.
      expect(t.repo(TransformationLog).all()).toEqual([
        expect.objectContaining({ id: conversion.id, isStored: false }),
      ]);
    });

    it('a persist() rejection never surfaces to the client', async () => {
      const alice = await t.seedUser();
      const failure = Promise.reject(new Error('disk exploded'));

      // The conversion service fires persist() with `void` and attaches no
      // handler of its own (see report); pre-attach one so the rejected test
      // double does not become an unhandled rejection of the test process.
      failure.catch(() => undefined);
      const persist = jest
        .spyOn(
          t.get<TransformationFileService>(TransformationFileService),
          'persist',
        )
        .mockReturnValue(failure);

      const res = await convert(alice, 'true').expect(200);

      expect(persist).toHaveBeenCalledTimes(1);
      expect(res.body).toEqual([{ a: '1', b: '2' }]);
      expect(t.repo(TransformationLog).all()).toEqual([
        expect.objectContaining({ status: 'success', isStored: false }),
      ]);
    });

    it('a storage failure during save is recorded, never surfaced, and the item is 404', async () => {
      const alice = await t.seedUser();
      const persist = jest.spyOn(
        t.get<TransformationFileService>(TransformationFileService),
        'persist',
      );

      jest
        .spyOn(t.get<StorageService>(StorageService), 'put')
        .mockRejectedValueOnce(
          Object.assign(new Error('no space'), { code: 'ENOSPC' }),
        );

      await convert(alice, 'true').expect(200);
      await expect(persist.mock.results[0].value).resolves.toBeUndefined();

      const [log] = t.repo(TransformationLog).all();

      expect(log).toMatchObject({
        isStored: false,
        storagePath: null,
        expiresAt: null,
        storageErrorCode: 'STORAGE_FULL',
      });
      await t
        .http()
        .get(own(log.id))
        .set('Cookie', t.authCookie(alice))
        .expect(404);
    });

    it('does not persist without save or with save=false', async () => {
      const alice = await t.seedUser();
      const persist = jest.spyOn(
        t.get<TransformationFileService>(TransformationFileService),
        'persist',
      );

      await convert(alice, 'false').expect(200);
      await t
        .http()
        .post('/api/convert')
        .set('Cookie', t.authCookie(alice))
        .field('targetFormat', 'json')
        .attach('file', Buffer.from('a,b\n1,2\n'), 'data.csv')
        .expect(200);

      expect(persist).not.toHaveBeenCalled();
    });

    it('end to end: saved output is downloadable until expiry, then purged', async () => {
      const alice = await t.seedUser();
      const persist = jest.spyOn(
        t.get<TransformationFileService>(TransformationFileService),
        'persist',
      );

      await convert(alice, 'true').expect(200);
      await persist.mock.results[0].value;

      const [log] = t
        .repo(TransformationLog)
        .all()
        .map((row) => ({ ...row }));

      expect(log).toMatchObject({
        isStored: true,
        storagePath: `2026-01-15/${alice.id}/${log.id}_json.json`,
        expiresAt: new Date(log.createdAt.getTime() + 90 * DAY),
        storageErrorCode: null,
      });

      const res = await t
        .http()
        .get(own(log.id))
        .set('Cookie', t.authCookie(alice))
        .expect(200);

      expect(res.headers['content-type']).toBe(
        'application/json; charset=utf-8',
      );
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="transformed_${log.id}.json"`,
      );
      expect(res.body).toEqual([{ a: '1', b: '2' }]);

      const history = await t
        .http()
        .get('/api/transformations/history')
        .set('Cookie', t.authCookie(alice))
        .expect(200);

      expect(history.body.items[0]).toMatchObject({
        id: log.id,
        isStored: true,
        expiresAt: log.expiresAt!.toISOString(),
      });

      // Retention elapses and the cleanup job runs.
      clock.advance(90 * DAY);
      await t
        .get<TransformationStorageCleanupScheduler>(
          TransformationStorageCleanupScheduler,
        )
        .run();

      const file = join(t.dirs.transformations, ...log.storagePath!.split('/'));

      expect(existsSync(file)).toBe(false);
      expect(t.repo(TransformationLog).all()[0]).toMatchObject({
        isStored: false,
        storagePath: null,
        expiresAt: log.expiresAt,
      });

      await t
        .http()
        .get(own(log.id))
        .set('Cookie', t.authCookie(alice))
        .expect(410);
    });
  });
});
