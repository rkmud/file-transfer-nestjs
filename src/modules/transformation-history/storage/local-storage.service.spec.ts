import { ConfigService } from '@nestjs/config';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { makeTempDir, removeDir } from '../../../../test/setup/temp-dir';
import { LocalStorageService } from './local-storage.service';

const readAll = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) chunks.push(Buffer.from(chunk));

  return Buffer.concat(chunks).toString();
};

const listRecursive = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

describe('LocalStorageService', () => {
  let root: string;
  let storage: LocalStorageService;

  beforeEach(() => {
    root = makeTempDir('ftn-local-storage-');
    storage = new LocalStorageService({
      getOrThrow: () => ({ localDir: root }),
    } as unknown as ConfigService);
  });

  afterEach(() => removeDir(root));

  const KEY = '2026-01-15/user/item_json.json';

  it('put() writes the content under the key and reports its size', async () => {
    await expect(
      storage.put(KEY, Readable.from(['{"a":', '1}'])),
    ).resolves.toEqual({
      size: 7,
    });
    expect(
      readFileSync(join(root, '2026-01-15', 'user', 'item_json.json'), 'utf8'),
    ).toBe('{"a":1}');
    expect(listRecursive(root)).toEqual(['item_json.json']);
  });

  it('put() overwrites an existing object via rename', async () => {
    await storage.put(KEY, Readable.from(['old content']));
    await storage.put(KEY, Readable.from(['new']));

    expect(await readAll(storage.openRead(KEY))).toBe('new');
  });

  it('a failed write leaves neither a promoted file nor a .part file', async () => {
    const failing = new Readable({
      read() {
        this.push('partial');
        this.destroy(new Error('source failed'));
      },
    });

    await expect(storage.put(KEY, failing)).rejects.toThrow('source failed');
    expect(existsSync(join(root, '2026-01-15', 'user', 'item_json.json'))).toBe(
      false,
    );
    expect(listRecursive(root)).toEqual([]);
  });

  it('a failed rename does not promote the .part file', async () => {
    // The destination is a directory, so rename() fails.
    await mkdir(join(root, '2026-01-15', 'user', 'item_json.json'), {
      recursive: true,
    });

    await expect(storage.put(KEY, Readable.from(['x']))).rejects.toThrow();
    expect(listRecursive(root)).toEqual([]);
  });

  it('a failure before the .part file exists rethrows the original error', async () => {
    writeFileSync(join(root, 'blocker'), 'x');

    await expect(
      storage.put('blocker/item.json', Readable.from(['x'])),
    ).rejects.toHaveProperty('code');
    expect(listRecursive(root)).toEqual(['blocker']);
  });

  it('stat() returns the size, null when missing or a directory', async () => {
    await storage.put(KEY, Readable.from(['abc']));

    await expect(storage.stat(KEY)).resolves.toEqual({ size: 3 });
    await expect(
      storage.stat('2026-01-15/user/missing.json'),
    ).resolves.toBeNull();
    await expect(storage.stat('2026-01-15/user')).resolves.toBeNull();
  });

  it('stat() rethrows errors other than ENOENT', async () => {
    writeFileSync(join(root, 'file'), 'x');

    // A path below a regular file fails with ENOTDIR.
    await expect(storage.stat('file/child')).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('openRead() streams the stored content', async () => {
    await storage.put(KEY, Readable.from(['hello']));

    expect(await readAll(storage.openRead(KEY))).toBe('hello');
  });

  it('delete() removes the object and ignores a missing one', async () => {
    await storage.put(KEY, Readable.from(['x']));

    await storage.delete(KEY);
    await expect(storage.stat(KEY)).resolves.toBeNull();
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
  });

  it('delete() rethrows errors other than ENOENT', async () => {
    await mkdir(join(root, 'dir'));

    await expect(storage.delete('dir')).rejects.toHaveProperty('code');
  });

  it.each(['../escape.txt', 'a/../../escape.txt', ''])(
    'rejects key %p outside the storage root',
    async (key) => {
      await expect(storage.stat(key)).rejects.toThrow(
        'Key is outside of the transformation storage',
      );
      expect(() => storage.openRead(key)).toThrow(
        'Key is outside of the transformation storage',
      );
    },
  );
});
