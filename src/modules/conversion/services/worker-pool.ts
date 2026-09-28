import { OnModuleDestroy } from '@nestjs/common';
import { Piscina } from 'piscina';

export class ConversionTimeoutError extends Error {
  constructor() {
    super('Conversion timed out');
    this.name = ConversionTimeoutError.name;
  }
}

export interface WorkerPoolOptions {
  filename: string;
  maxThreads: number;
  maxHeapMb: number;
  timeoutMs: number;
}

export const isWorkerOutOfMemory = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY';

export abstract class WorkerPool<TTask, TResult> implements OnModuleDestroy {
  private readonly pool: Piscina<TTask, TResult>;
  private readonly timeoutMs: number;

  protected constructor({
    filename,
    maxThreads,
    maxHeapMb,
    timeoutMs,
  }: WorkerPoolOptions) {
    this.timeoutMs = timeoutMs;
    this.pool = new Piscina({
      filename,
      minThreads: 1,
      maxThreads,
      idleTimeout: 60_000,
      resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
    });
  }

  protected async execute(task: TTask): Promise<TResult> {
    try {
      return await this.pool.run(task, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ConversionTimeoutError();
      }

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.destroy();
  }
}
