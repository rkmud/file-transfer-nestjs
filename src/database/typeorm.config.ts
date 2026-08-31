import { DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/configuration';

export const buildDataSourceOptions = (
  config: DatabaseConfig,
): DataSourceOptions => ({
  type: 'postgres',
  host: config.host,
  port: config.port,
  username: config.username,
  password: config.password,
  database: config.database,
  synchronize: config.synchronize,
  logging: config.logging,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsRun: false,
});
