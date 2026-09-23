import 'dotenv/config';
import { DataSource } from 'typeorm';
import configuration from '@/core/config/configuration';
import { buildDataSourceOptions } from './typeorm.config';

export default new DataSource(buildDataSourceOptions(configuration().database));
