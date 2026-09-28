import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { ConversionConfig } from '@/core/config/configuration';
import {
  ConversionTask,
  ConversionTaskResult,
} from '../worker/conversion.task';
import { isWorkerOutOfMemory, WorkerPool } from './worker-pool';

export { ConversionTimeoutError } from './worker-pool';

@Injectable()
export class ConversionWorkerPool extends WorkerPool<
  ConversionTask,
  ConversionTaskResult
> {
  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<ConversionConfig>('conversion');

    super({
      filename: resolve(__dirname, '../worker/conversion.worker.js'),
      maxThreads: config.workerThreads,
      maxHeapMb: config.workerMaxHeapMb,
      timeoutMs: config.timeoutMs,
    });
  }

  async run(task: ConversionTask): Promise<ConversionTaskResult> {
    try {
      return await this.execute(task);
    } catch (error) {
      if (isWorkerOutOfMemory(error)) {
        return {
          ok: false,
          code: 'LIMIT_EXCEEDED',
          message: 'Document is too complex to convert',
        };
      }

      throw error;
    }
  }
}
