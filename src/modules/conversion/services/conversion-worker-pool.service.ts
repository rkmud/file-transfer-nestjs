import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { Piscina } from 'piscina';
import { ConversionConfig } from '@/core/config/configuration';
import {
  ConversionTask,
  ConversionTaskResult,
} from '../worker/conversion.task';

export class ConversionTimeoutError extends Error {
  constructor() {
    super('Conversion timed out');
    this.name = ConversionTimeoutError.name;
  }
}

@Injectable()
export class ConversionWorkerPool implements OnModuleDestroy {
  private readonly pool: Piscina<ConversionTask, ConversionTaskResult>;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<ConversionConfig>('conversion');

    this.timeoutMs = config.timeoutMs;
    this.pool = new Piscina({
      filename: resolve(__dirname, '../worker/conversion.worker.js'),
      minThreads: 1,
      maxThreads: config.workerThreads,
      idleTimeout: 60_000,
      resourceLimits: { maxOldGenerationSizeMb: config.workerMaxHeapMb },
    });
  }

  async run(task: ConversionTask): Promise<ConversionTaskResult> {
    try {
      return await this.pool.run(task, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ConversionTimeoutError();
      }

      if (
        (error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY'
      ) {
        return {
          ok: false,
          code: 'LIMIT_EXCEEDED',
          message: 'Document is too complex to convert',
        };
      }

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.destroy();
  }
}
