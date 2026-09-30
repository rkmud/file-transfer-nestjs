import { DatabaseConfig } from '@/core/config/configuration';
import { buildDataSourceOptions } from './typeorm.config';

describe('buildDataSourceOptions', () => {
  const config: DatabaseConfig = {
    host: 'db.internal',
    port: 6543,
    username: 'svc',
    password: 'pw',
    database: 'files',
    synchronize: false,
    logging: true,
  };

  it('builds postgres options from the database config slice', () => {
    expect(buildDataSourceOptions(config)).toEqual({
      type: 'postgres',
      host: 'db.internal',
      port: 6543,
      username: 'svc',
      password: 'pw',
      database: 'files',
      synchronize: false,
      logging: true,
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/migrations/*{.ts,.js}'],
      migrationsRun: false,
    });
  });

  it('passes synchronize through and never runs migrations automatically', () => {
    const options = buildDataSourceOptions({ ...config, synchronize: true });

    expect(options.synchronize).toBe(true);
    expect(options.migrationsRun).toBe(false);
  });
});
