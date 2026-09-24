import {
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { basename, join, posix, resolve } from 'path';
import { UploadsConfig } from '@/core/config/configuration';
import { AVATARS_SUBDIR } from './user-profile.constants';
import { AvatarFormat } from './user-profile.types';

const MIME_TYPES: Record<string, AvatarFormat> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean =>
  bytes.every((byte, index) => buffer[offset + index] === byte);

const ascii = (text: string): number[] =>
  [...text].map((char) => char.charCodeAt(0));

/**
 * The client-supplied mime type is trivially spoofed, so the actual format is
 * taken from the file signature.
 */
const detectFormat = (buffer: Buffer): AvatarFormat | null => {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (
    startsWith(buffer, ascii('GIF87a')) ||
    startsWith(buffer, ascii('GIF89a'))
  ) {
    return 'gif';
  }
  if (
    startsWith(buffer, ascii('RIFF')) &&
    startsWith(buffer, ascii('WEBP'), 8)
  ) {
    return 'webp';
  }

  return null;
};

@Injectable()
export class AvatarStorageService {
  private readonly logger = new Logger(AvatarStorageService.name);

  constructor(private configService: ConfigService) {}

  /** Throws 413/415 for files that must not be stored. */
  validate(file: Express.Multer.File): AvatarFormat {
    if (file.size > this.getConfig().avatarMaxBytes) {
      throw new PayloadTooLargeException('Avatar image exceeds the size limit');
    }

    const declared = MIME_TYPES[file.mimetype];
    const detected = detectFormat(file.buffer);

    if (!declared || !detected || declared !== detected) {
      throw new UnsupportedMediaTypeException(
        'Avatar must be a JPEG, PNG, WebP or GIF image',
      );
    }

    return detected;
  }

  /** Writes the file and returns the relative public path stored in the DB. */
  async save(file: Express.Multer.File, format: AvatarFormat): Promise<string> {
    const fileName = `${randomUUID()}.${format}`;
    const directory = this.getDirectory();

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), file.buffer);

    return posix.join(this.getConfig().publicPrefix, AVATARS_SUBDIR, fileName);
  }

  /** Best-effort removal of a previously stored avatar. */
  async remove(publicPath: string | null): Promise<void> {
    const prefix = posix.join(this.getConfig().publicPrefix, AVATARS_SUBDIR);

    if (!publicPath?.startsWith(`${prefix}/`)) {
      return;
    }

    try {
      await unlink(join(this.getDirectory(), basename(publicPath)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Failed to remove avatar ${publicPath}`);
      }
    }
  }

  private getDirectory(): string {
    return resolve(this.getConfig().dir, AVATARS_SUBDIR);
  }

  private getConfig(): UploadsConfig {
    return this.configService.getOrThrow<UploadsConfig>('uploads');
  }
}
