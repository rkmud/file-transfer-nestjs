import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { makeTempDir, removeDir } from '../../../../test/setup/temp-dir';
import { CONVERSION_LINGERING_CLEANUP_DELAYS_MS } from '../conversion.constants';
import {
  LocalConversionStorage,
  resolveIncomingDirectory,
} from './conversion-storage.service';

jest.mock('timers/promises', () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));

const readStream = (stream: NodeJS.ReadableStream): Promise<string> =>
  new Promise((done, fail) => {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', fail);
  });

describe('resolveIncomingDirectory', () => {
  it('resolves <storageDir>/incoming to an absolute path', () => {
    expect(resolveIncomingDirectory({ storageDir: 'rel/dir' } as never)).toBe(
      join(resolve('rel/dir'), 'incoming'),
    );
  });
});

describe('LocalConversionStorage', () => {
  let root: string;
  let storage: LocalConversionStorage;

  beforeEach(() => {
    root = makeTempDir('ftn-storage-');
    storage = new LocalConversionStorage({
      getOrThrow: jest.fn().mockReturnValue({ storageDir: root }),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    removeDir(root);
    jest.restoreAllMocks();
  });

  const writeIncoming = (name: string, content: string): string => {
    const dir = join(root, 'incoming');

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), content);

    return join(dir, name);
  };

  describe('readHead', () => {
    it('returns at most the requested number of bytes', async () => {
      const path = writeIncoming('a', 'abcdef');

      await expect(storage.readHead(path, 3)).resolves.toEqual(
        Buffer.from('abc'),
      );
      await expect(storage.readHead(path, 100)).resolves.toEqual(
        Buffer.from('abcdef'),
      );
    });

    it('rejects paths outside of the storage root', async () => {
      await expect(storage.readHead('/etc/passwd', 4)).rejects.toThrow(
        'Path is outside of the conversion storage',
      );
      await expect(
        storage.readHead(join(root, '..', 'escape'), 4),
      ).rejects.toThrow('outside');
      await expect(storage.readHead(root, 4)).rejects.toThrow('outside');
    });
  });

  it('storeInput moves the upload to inputs/<userId>/<id><ext>', async () => {
    const upload = writeIncoming('u1', 'payload');

    const stored = await storage.storeInput(upload, 'user-1', 'conv-1', '.csv');

    expect(stored).toBe(join(root, 'inputs', 'user-1', 'conv-1.csv'));
    expect(readFileSync(stored, 'utf8')).toBe('payload');
    expect(existsSync(upload)).toBe(false);
  });

  it('storeInput refuses an upload outside of the root', async () => {
    await expect(
      storage.storeInput('/tmp/elsewhere', 'u', 'i', '.csv'),
    ).rejects.toThrow('outside');
  });

  it('prepareOutput creates the directory and a .part temp path', async () => {
    const target = await storage.prepareOutput('user-1', 'conv-1', '.json');

    expect(target).toEqual({
      finalPath: join(root, 'outputs', 'user-1', 'conv-1.json'),
      tempPath: join(root, 'outputs', 'user-1', 'conv-1.json.part'),
    });
    expect(existsSync(join(root, 'outputs', 'user-1'))).toBe(true);
  });

  it('commitOutput renames the .part file to its final name', async () => {
    const target = await storage.prepareOutput('user-1', 'conv-2', '.json');

    writeFileSync(target.tempPath, '{}');
    await storage.commitOutput(target);

    expect(existsSync(target.tempPath)).toBe(false);
    expect(readFileSync(target.finalPath, 'utf8')).toBe('{}');
  });

  describe('remove', () => {
    it('ignores an undefined path', async () => {
      await expect(storage.remove(undefined)).resolves.toBeUndefined();
    });

    it('deletes an existing file', async () => {
      const path = writeIncoming('r1', 'x');

      await storage.remove(path);

      expect(existsSync(path)).toBe(false);
    });

    it('silently ignores a missing file', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await storage.remove(join(root, 'incoming', 'missing'));

      expect(warn).not.toHaveBeenCalled();
    });

    it('logs a relative path when the delete fails for another reason', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const dir = join(root, 'incoming', 'a-directory');

      mkdirSync(dir, { recursive: true });
      await storage.remove(dir);

      expect(warn).toHaveBeenCalledWith(
        'Failed to remove incoming/a-directory',
      );
    });

    it('logs instead of throwing for a path outside of the root', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await expect(storage.remove('/etc/hosts')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('removeLingering', () => {
    it('ignores an undefined path', async () => {
      (sleep as unknown as jest.Mock).mockClear();

      await storage.removeLingering(undefined);

      expect(sleep).not.toHaveBeenCalled();
    });

    it('retries the delete after each configured delay', async () => {
      (sleep as unknown as jest.Mock).mockClear();
      const remove = jest.spyOn(storage, 'remove');
      const path = writeIncoming('late.part', 'x');

      await storage.removeLingering(path);

      expect((sleep as unknown as jest.Mock).mock.calls).toEqual(
        CONVERSION_LINGERING_CLEANUP_DELAYS_MS.map((delay) => [delay]),
      );
      expect(remove).toHaveBeenCalledTimes(
        CONVERSION_LINGERING_CLEANUP_DELAYS_MS.length,
      );
      expect(existsSync(path)).toBe(false);
    });
  });

  it('openRead streams a contained file', async () => {
    const path = writeIncoming('o1', 'hello');

    await expect(readStream(storage.openRead(path))).resolves.toBe('hello');
    expect(() => storage.openRead('/etc/hosts')).toThrow('outside');
  });

  it('toRelative returns a forward-slash path relative to the root', () => {
    expect(storage.toRelative(join(root, 'outputs', 'u', 'x.json'))).toBe(
      'outputs/u/x.json',
    );
  });
});
