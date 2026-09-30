import { ConfigService } from '@nestjs/config';
import { Piscina } from 'piscina';
import { resolve } from 'path';
import {
  ConversionTimeoutError,
  ConversionWorkerPool,
} from './conversion-worker-pool.service';
import { ConversionTask } from '../worker/conversion.task';

jest.mock('piscina', () => ({
  Piscina: jest.fn().mockImplementation(() => ({
    run: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

const PiscinaMock = Piscina as unknown as jest.Mock;

const CONFIG = {
  workerThreads: 2,
  workerMaxHeapMb: 128,
  timeoutMs: 5000,
};

const TASK: ConversionTask = {
  inputPath: '/in.csv',
  inputSize: 10,
  outputPath: '/out.json.part',
  sourceFormat: 'csv',
  targetFormat: 'json',
  limits: { maxDepth: 1, maxNodes: 1, maxYamlAliases: 1 },
  streamThresholdBytes: 1,
};

describe('ConversionWorkerPool', () => {
  let pool: ConversionWorkerPool;
  let piscina: { run: jest.Mock; destroy: jest.Mock };
  let getOrThrow: jest.Mock;

  beforeEach(() => {
    PiscinaMock.mockClear();
    getOrThrow = jest.fn().mockReturnValue(CONFIG);
    pool = new ConversionWorkerPool({ getOrThrow } as unknown as ConfigService);
    piscina = PiscinaMock.mock.results[0].value;
  });

  it('reads the conversion config slice and targets the compiled worker', () => {
    expect(getOrThrow).toHaveBeenCalledWith('conversion');
    expect(PiscinaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: resolve(__dirname, '../worker/conversion.worker.js'),
        maxThreads: 2,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      }),
    );
  });

  it('returns the worker result', async () => {
    piscina.run.mockResolvedValue({ ok: true, outputSize: 7 });

    await expect(pool.run(TASK)).resolves.toEqual({ ok: true, outputSize: 7 });
    expect(piscina.run).toHaveBeenCalledWith(TASK, expect.anything());
  });

  it('maps ERR_WORKER_OUT_OF_MEMORY to a LIMIT_EXCEEDED result', async () => {
    piscina.run.mockRejectedValue(
      Object.assign(new Error('oom'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }),
    );

    await expect(pool.run(TASK)).resolves.toEqual({
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message: 'Document is too complex to convert',
    });
  });

  it('throws ConversionTimeoutError when the task is aborted', async () => {
    piscina.run.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    await expect(pool.run(TASK)).rejects.toBeInstanceOf(ConversionTimeoutError);
  });

  it('rethrows other worker errors', async () => {
    const failure = new Error('crash');

    piscina.run.mockRejectedValue(failure);

    await expect(pool.run(TASK)).rejects.toBe(failure);
  });

  it('destroys the pool on module destroy', async () => {
    await pool.onModuleDestroy();

    expect(piscina.destroy).toHaveBeenCalled();
  });
});
