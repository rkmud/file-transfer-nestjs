import { ConfigService } from '@nestjs/config';
import { Piscina } from 'piscina';
import { ImageWorkerPool } from './image-worker-pool.service';
import { ConversionTimeoutError } from './worker-pool';
import { ImageTask } from '../worker/image.task';

const piscinaRun = jest.fn();
const piscinaDestroy = jest.fn().mockResolvedValue(undefined);

jest.mock('piscina', () => ({
  Piscina: jest.fn().mockImplementation(() => ({
    run: piscinaRun,
    destroy: piscinaDestroy,
  })),
}));

describe('ImageWorkerPool', () => {
  const config = {
    maxSizes: {},
    maxRasterWidth: 4096,
    maxRasterHeight: 4096,
    maxInputPixels: 50_000_000,
    timeoutMs: 1234,
    workerThreads: 3,
    workerMaxHeapMb: 256,
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(config),
  } as unknown as ConfigService;
  const task = { inputPath: '/in', outputPath: '/out' } as ImageTask;
  let pool: ImageWorkerPool;

  beforeEach(() => {
    jest.clearAllMocks();
    pool = new ImageWorkerPool(configService);
  });

  it('creates a Piscina pool for the image worker from the imageConversion config', () => {
    expect(configService.getOrThrow).toHaveBeenCalledWith('imageConversion');
    expect(Piscina).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: expect.stringMatching(/worker[\\/]image\.worker\.js$/),
        minThreads: 1,
        maxThreads: 3,
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      }),
    );
  });

  it('runs the task with a timeout signal and returns the worker result', async () => {
    const result = { ok: true, outputSize: 1, width: 1, height: 1 };

    piscinaRun.mockResolvedValueOnce(result);

    await expect(pool.run(task)).resolves.toBe(result);
    expect(piscinaRun).toHaveBeenCalledWith(task, {
      signal: expect.any(AbortSignal),
    });
  });

  it('maps a worker out-of-memory crash to EXCEEDED_MAX_PIXELS', async () => {
    piscinaRun.mockRejectedValueOnce(
      Object.assign(new Error('oom'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }),
    );

    await expect(pool.run(task)).resolves.toEqual({
      ok: false,
      code: 'EXCEEDED_MAX_PIXELS',
      message: 'Image is too large to convert',
    });
  });

  it('maps an aborted run to ConversionTimeoutError', async () => {
    piscinaRun.mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    await expect(pool.run(task)).rejects.toBeInstanceOf(ConversionTimeoutError);
  });

  it('rethrows any other failure', async () => {
    const failure = new Error('crash');

    piscinaRun.mockRejectedValueOnce(failure);

    await expect(pool.run(task)).rejects.toBe(failure);
  });

  it('destroys the pool on module destroy', async () => {
    await pool.onModuleDestroy();

    expect(piscinaDestroy).toHaveBeenCalled();
  });
});
