import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import * as process from 'node:process';
import * as path from 'node:path';
import { SnakeNamingStrategy } from '../utility/snake-naming.strategy';

const dbConfig = (): PostgresConnectionOptions => ({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: +process.env.DATABASE_PORT,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl:
    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: [path.resolve(__dirname, '..') + '/**/*.entity{.ts,.js}'],
  synchronize: false,
  namingStrategy: new SnakeNamingStrategy(),
  logging: process.env.DATABASE_LOGGING === 'true',
  migrations: [path.resolve(__dirname, '..') + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  migrationsRun: true,
  // Connection pooling configuration optimized for 200+ concurrent workers
  // Calculated pool size: ceil(200 concurrent users * 0.2) + 10 buffer = 50 connections
  poolSize: process.env.DATABASE_POOL_SIZE
    ? +process.env.DATABASE_POOL_SIZE
    : 50,
  extra: {
    max: process.env.DATABASE_POOL_SIZE ? +process.env.DATABASE_POOL_SIZE : 50,
    min: process.env.DATABASE_POOL_MIN ? +process.env.DATABASE_POOL_MIN : 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    poolTimeoutMillis: 5000,
    reapIntervalMillis: 10000,
    log: process.env.DATABASE_POOL_LOG === 'true',
    pool_mode: process.env.DATABASE_POOL || 'transaction',
    application_name: process.env.APP_NAME || 'discuva-api',
    ...(process.env.NODE_ENV === 'development' && {
      debug: process.env.DATABASE_DEBUG === 'true',
    }),
  },
});

export default dbConfig;
