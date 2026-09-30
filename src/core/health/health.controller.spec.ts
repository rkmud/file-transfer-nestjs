import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  it('delegates to HealthService.check()', async () => {
    const result = { status: 'ok', database: 'up' };
    const service = { check: jest.fn().mockResolvedValue(result) };
    const controller = new HealthController(
      service as unknown as HealthService,
    );

    await expect(controller.check()).resolves.toBe(result);
    expect(service.check).toHaveBeenCalledTimes(1);
  });
});
