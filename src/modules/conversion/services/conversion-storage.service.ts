import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, ReadStream } from 'fs';
import { mkdir, open, rename, unlink } from 'fs/promises';
import { dirname, join, relative, resolve, sep } from 'path';
import { ConversionConfig } from '@/core/config/configuration';
import {
  CONVERSION_INCOMING_SUBDIR,
  CONVERSION_INPUTS_SUBDIR,
  CONVERSION_OUTPUTS_SUBDIR,
  CONVERSION_PARTIAL_SUFFIX,
} from '../conversion.constants';

export const resolveIncomingDirectory = ({
  storageDir,
}: ConversionConfig): string =>
  join(resolve(storageDir), CONVERSION_INCOMING_SUBDIR);

export interface OutputTarget {
  tempPath: string;
  finalPath: string;
}

export abstract class ConversionStorage {
  abstract readHead(path: string, bytes: number): Promise<Buffer>;
  abstract storeInput(
    uploadPath: string,
    userId: string,
    id: string,
    extension: string,
  ): Promise<string>;
  abstract prepareOutput(
    userId: string,
    id: string,
    extension: string,
  ): Promise<OutputTarget>;
  abstract commitOutput(target: OutputTarget): Promise<void>;
  abstract remove(path: string | undefined): Promise<void>;
  abstract openRead(path: string): ReadStream;
  abstract toRelative(path: string): string;
}

@Injectable()
export class LocalConversionStorage extends ConversionStorage {
  private readonly logger = new Logger(LocalConversionStorage.name);
  private readonly root: string;

  constructor(configService: ConfigService) {
    super();
    this.root = resolve(
      configService.getOrThrow<ConversionConfig>('conversion').storageDir,
    );
  }

  async readHead(path: string, bytes: number): Promise<Buffer> {
    const handle = await open(this.contained(path), 'r');

    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);

      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async storeInput(
    uploadPath: string,
    userId: string,
    id: string,
    extension: string,
  ): Promise<string> {
    const destination = join(
      this.root,
      CONVERSION_INPUTS_SUBDIR,
      userId,
      `${id}${extension}`,
    );

    await mkdir(dirname(destination), { recursive: true });
    await rename(this.contained(uploadPath), destination);

    return destination;
  }

  async prepareOutput(
    userId: string,
    id: string,
    extension: string,
  ): Promise<OutputTarget> {
    const finalPath = join(
      this.root,
      CONVERSION_OUTPUTS_SUBDIR,
      userId,
      `${id}${extension}`,
    );

    await mkdir(dirname(finalPath), { recursive: true });

    return { tempPath: `${finalPath}${CONVERSION_PARTIAL_SUFFIX}`, finalPath };
  }

  async commitOutput({ tempPath, finalPath }: OutputTarget): Promise<void> {
    await rename(tempPath, finalPath);
  }

  async remove(path: string | undefined): Promise<void> {
    if (!path) return;

    try {
      await unlink(this.contained(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Failed to remove ${this.toRelative(path)}`);
      }
    }
  }

  openRead(path: string): ReadStream {
    return createReadStream(this.contained(path));
  }

  toRelative(path: string): string {
    return relative(this.root, path).split(sep).join('/');
  }

  private contained(path: string): string {
    const absolute = resolve(path);

    if (!absolute.startsWith(`${this.root}${sep}`)) {
      throw new Error('Path is outside of the conversion storage');
    }

    return absolute;
  }
}
