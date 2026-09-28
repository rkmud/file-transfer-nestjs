import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import 'sharp';
import { ImageConversionConfig } from '@/core/config/configuration';
import { ImageTask, ImageTaskResult } from '../worker/image.task';
import { isWorkerOutOfMemory, WorkerPool } from './worker-pool';

@Injectable()
export class ImageWorkerPool extends WorkerPool<ImageTask, ImageTaskResult> {
  constructor(configService: ConfigService) {
    const config =
      configService.getOrThrow<ImageConversionConfig>('imageConversion');

    super({
      filename: resolve(__dirname, '../worker/image.worker.js'),
      maxThreads: config.workerThreads,
      maxHeapMb: config.workerMaxHeapMb,
      timeoutMs: config.timeoutMs,
    });
  }

  async run(task: ImageTask): Promise<ImageTaskResult> {
    try {
      return await this.execute(task);
    } catch (error) {
      if (isWorkerOutOfMemory(error)) {
        return {
          ok: false,
          code: 'EXCEEDED_MAX_PIXELS',
          message: 'Image is too large to convert',
        };
      }

      throw error;
    }
  }
}
