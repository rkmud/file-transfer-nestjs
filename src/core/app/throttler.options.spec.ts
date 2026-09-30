import { ConfigService } from '@nestjs/config';
import { createThrottlerOptions } from './throttler.options';

describe('createThrottlerOptions', () => {
  it('maps the throttle config slice (seconds) to a single throttler (ms)', () => {
    const getOrThrow = jest
      .fn()
      .mockReturnValue({ ttlSeconds: 60, limit: 10, blockSeconds: 30 });

    const options = createThrottlerOptions({
      getOrThrow,
    } as unknown as ConfigService);

    expect(getOrThrow).toHaveBeenCalledWith('throttle');
    expect(options).toEqual({
      throttlers: [{ ttl: 60_000, limit: 10, blockDuration: 30_000 }],
    });
  });

  it('propagates a missing config slice', () => {
    const getOrThrow = jest.fn(() => {
      throw new TypeError('Configuration key "throttle" does not exist');
    });

    expect(() =>
      createThrottlerOptions({ getOrThrow } as unknown as ConfigService),
    ).toThrow('throttle');
  });
});
