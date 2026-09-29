import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rename, stat, unlink } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { TransformationStorageConfig } from '@/core/config/configuration';
import { StorageService, StoredObject } from './storage.service';

const PARTIAL_SUFFIX = '.part';

const isNotFound = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ENOENT';

@Injectable()
export class LocalStorageService extends StorageService {
  private readonly root: string;

  constructor(configService: ConfigService) {
    super();
    this.root = resolve(
      configService.getOrThrow<TransformationStorageConfig>(
        'transformationStorage',
      ).localDir,
    );
  }

  async put(key: string, content: Readable): Promise<StoredObject> {
    const destination = this.resolveKey(key);
    const tempPath = `${destination}.${randomUUID()}${PARTIAL_SUFFIX}`;

    try {
      await mkdir(dirname(destination), { recursive: true });
      await pipeline(content, createWriteStream(tempPath, { flags: 'wx' }));
      await rename(tempPath, destination);
    } catch (error) {
      content.destroy();
      await unlink(tempPath).catch(() => undefined);

      throw error;
    }

    return { size: (await stat(destination)).size };
  }

  async stat(key: string): Promise<StoredObject | null> {
    try {
      const stats = await stat(this.resolveKey(key));

      return stats.isFile() ? { size: stats.size } : null;
    } catch (error) {
      if (isNotFound(error)) return null;

      throw error;
    }
  }

  openRead(key: string): Readable {
    return createReadStream(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private resolveKey(key: string): string {
    const absolute = resolve(this.root, ...key.split('/'));

    if (!absolute.startsWith(`${this.root}${sep}`)) {
      throw new Error('Key is outside of the transformation storage');
    }

    return absolute;
  }
}
