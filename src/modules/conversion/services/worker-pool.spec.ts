import { Piscina } from 'piscina';
import {
  ConversionTimeoutError,
  isWorkerOutOfMemory,
  WorkerPool,
  WorkerPoolOptions,
} from './worker-pool';

jest.mock('piscina', () => ({
  Piscina: jest.fn().mockImplementation(() => ({
    run: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

const PiscinaMock = Piscina as unknown as jest.Mock;

class TestPool extends WorkerPool<{ n: number }, number> {
  constructor(options: WorkerPoolOptions) {
    super(options);
  }

  exec(task: { n: number }): Promise<number> {
    return this.execute(task);
  }
}

const OPTIONS: WorkerPoolOptions = {
  filename: '/abs/worker.js',
  maxThreads: 3,
  maxHeapMb: 256,
  timeoutMs: 1234,
};

const lastPiscina = (): { run: jest.Mock; destroy: jest.Mock } =>
  PiscinaMock.mock.results[PiscinaMock.mock.results.length - 1].value;

describe('WorkerPool', () => {
  beforeEach(() => PiscinaMock.mockClear());

  it('configures Piscina from the options', () => {
    new TestPool(OPTIONS);

    expect(PiscinaMock).toHaveBeenCalledWith({
      filename: '/abs/worker.js',
      minThreads: 1,
      maxThreads: 3,
      idleTimeout: 60_000,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
  });

  it('runs a task with an abort signal derived from timeoutMs', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const pool = new TestPool(OPTIONS);

    lastPiscina().run.mockResolvedValue(42);

    await expect(pool.exec({ n: 1 })).resolves.toBe(42);
    expect(timeout).toHaveBeenCalledWith(1234);
    expect(lastPiscina().run).toHaveBeenCalledWith(
      { n: 1 },
      { signal: timeout.mock.results[0].value },
    );
    timeout.mockRestore();
  });

  it('maps an AbortError to ConversionTimeoutError', async () => {
    const pool = new TestPool(OPTIONS);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });

    lastPiscina().run.mockRejectedValue(abort);

    const error = await pool.exec({ n: 1 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConversionTimeoutError);
    expect(error).toMatchObject({
      name: 'ConversionTimeoutError',
      message: 'Conversion timed out',
    });
  });

  it('rethrows any other error unchanged', async () => {
    const pool = new TestPool(OPTIONS);
    const failure = new Error('worker crashed');

    lastPiscina().run.mockRejectedValue(failure);

    await expect(pool.exec({ n: 1 })).rejects.toBe(failure);
  });

  it('destroys the Piscina pool on module destroy', async () => {
    const pool = new TestPool(OPTIONS);

    await pool.onModuleDestroy();

    expect(lastPiscina().destroy).toHaveBeenCalledTimes(1);
  });
});

describe('isWorkerOutOfMemory', () => {
  it('detects ERR_WORKER_OUT_OF_MEMORY only', () => {
    expect(
      isWorkerOutOfMemory(
        Object.assign(new Error('oom'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }),
      ),
    ).toBe(true);
    expect(isWorkerOutOfMemory(new Error('other'))).toBe(false);
    expect(
      isWorkerOutOfMemory(Object.assign(new Error('x'), { code: 'EPIPE' })),
    ).toBe(false);
  });
});
