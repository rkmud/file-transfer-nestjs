import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const build = (query: jest.Mock) =>
    new HealthService({ query } as unknown as DataSource);

  it('reports ok/up when the database answers SELECT 1', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(build(query).check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports error/down when the database query rejects', async () => {
    const query = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(build(query).check()).resolves.toEqual({
      status: 'error',
      database: 'down',
    });
  });
});
