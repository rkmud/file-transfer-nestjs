import {
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { useTempDir } from '../../../test/setup/temp-dir';
import { AvatarStorageService } from './avatar-storage.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]);
const GIF87 = Buffer.from('GIF87a....');
const GIF89 = Buffer.from('GIF89a....');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

const file = (
  mimetype: string,
  buffer: Buffer,
  size = buffer.length,
): Express.Multer.File => ({ mimetype, buffer, size }) as Express.Multer.File;

describe('AvatarStorageService', () => {
  const temp = useTempDir('ftn-avatars-');
  let uploadsDir: string;
  let counter = 0;
  let service: AvatarStorageService;

  beforeEach(() => {
    uploadsDir = join(temp.path, `uploads-${++counter}`);
    mkdirSync(uploadsDir);
    const config = {
      getOrThrow: jest.fn(() => ({
        dir: uploadsDir,
        publicPrefix: '/static',
        avatarMaxBytes: 1024,
      })),
    } as unknown as ConfigService;

    service = new AvatarStorageService(config);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('validate', () => {
    it.each([
      ['image/png', PNG, 'png'],
      ['image/jpeg', JPEG, 'jpg'],
      ['image/gif', GIF87, 'gif'],
      ['image/gif', GIF89, 'gif'],
      ['image/webp', WEBP, 'webp'],
    ])('accepts %s with a matching signature', (mime, buffer, format) => {
      expect(service.validate(file(mime, buffer))).toBe(format);
    });

    it('accepts a file of exactly the size limit', () => {
      expect(service.validate(file('image/png', PNG, 1024))).toBe('png');
    });

    it('rejects a file over the size limit with 413', () => {
      expect(() => service.validate(file('image/png', PNG, 1025))).toThrow(
        PayloadTooLargeException,
      );
    });

    it.each([
      ['unsupported MIME type', 'image/svg+xml', PNG],
      ['unknown signature', 'image/png', Buffer.from('hello world')],
      ['MIME and signature disagree', 'image/jpeg', PNG],
      ['RIFF without WEBP', 'image/webp', Buffer.from('RIFF....AVI ')],
    ])('rejects %s with 415', (_name, mime, buffer) => {
      expect(() => service.validate(file(mime, buffer))).toThrow(
        UnsupportedMediaTypeException,
      );
    });
  });

  describe('save / remove', () => {
    it('writes inside UPLOADS_DIR/avatars and returns the public path', async () => {
      const publicPath = await service.save(file('image/png', PNG), 'png');

      expect(publicPath).toMatch(/^\/static\/avatars\/[0-9a-f-]{36}\.png$/);

      const stored = join(uploadsDir, 'avatars', publicPath.split('/').pop()!);
      const rel = relative(resolve(uploadsDir), resolve(stored));

      expect(rel.startsWith('..')).toBe(false);
      expect(readFileSync(stored)).toEqual(PNG);

      await service.remove(publicPath);
      expect(existsSync(stored)).toBe(false);
    });

    it('never deletes outside the avatars directory', async () => {
      const outside = join(uploadsDir, 'secret.txt');

      writeFileSync(outside, 'keep');
      mkdirSync(join(uploadsDir, 'avatars'));

      await service.remove('/static/avatars/../secret.txt');
      await service.remove('/elsewhere/secret.txt');
      await service.remove('/static/avatarsX/secret.txt');
      await service.remove(null);

      expect(readFileSync(outside, 'utf8')).toBe('keep');
    });

    it('ignores a missing file silently', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');

      await expect(
        service.remove('/static/avatars/missing.png'),
      ).resolves.toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it('logs, but does not throw, on other unlink failures', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      mkdirSync(join(uploadsDir, 'avatars', 'dir.png'), { recursive: true });

      await expect(
        service.remove('/static/avatars/dir.png'),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'Failed to remove avatar /static/avatars/dir.png',
      );
    });
  });
});
