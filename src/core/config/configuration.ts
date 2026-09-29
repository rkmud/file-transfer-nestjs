import { validateCronExpression } from 'cron';
import ms from 'ms';
import { availableParallelism } from 'os';

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
}

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}

export interface RbacConfigOptions {
  cacheTtlSeconds: number;
}

export interface SwaggerConfig {
  enabled: boolean;
  path: string;
}

export interface OtpConfig {
  ttlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
}

export interface LoginConfig {
  maxFailedAttempts: number;
  lockoutSeconds: number;
}

export interface ThrottleConfig {
  ttlSeconds: number;
  limit: number;
  blockSeconds: number;
}

export interface CookieConfig {
  secure: boolean;
  domain: string | undefined;
}

export interface UploadsConfig {
  dir: string;
  publicPrefix: string;
  avatarMaxBytes: number;
}

export interface ConversionConfig {
  storageDir: string;
  maxSizes: Record<string, number>;
  timeoutMs: number;
  maxDepth: number;
  maxNodes: number;
  maxYamlAliases: number;
  workerThreads: number;
  workerMaxHeapMb: number;
}

export interface ImageConversionConfig {
  maxSizes: Record<string, number>;
  maxRasterWidth: number;
  maxRasterHeight: number;
  maxInputPixels: number;
  timeoutMs: number;
  workerThreads: number;
  workerMaxHeapMb: number;
}

export const STORAGE_BACKENDS = ['LOCAL_STORAGE'] as const;

export type StorageBackend = (typeof STORAGE_BACKENDS)[number];

export interface TransformationStorageConfig {
  backend: StorageBackend;
  localDir: string;
  retentionDays: number;
  cleanupCron: string;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  appUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessExpiresIn: string;
  jwtAccessExpiresInMs: number;
  jwtRefreshExpiresIn: string;
  jwtRefreshExpiresInMs: number;
  cookie: CookieConfig;
  database: DatabaseConfig;
  mail: MailConfig;
  otp: OtpConfig;
  login: LoginConfig;
  throttle: ThrottleConfig;
  rbac: RbacConfigOptions;
  swagger: SwaggerConfig;
  uploads: UploadsConfig;
  conversion: ConversionConfig;
  imageConversion: ImageConversionConfig;
  transformationStorage: TransformationStorageConfig;
}

const MB = 1024 * 1024;

const defaultWorkerThreads = (): number =>
  Math.min(4, Math.max(1, availableParallelism() - 1));

const parseIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }

  return value;
};

const parseStorageBackendEnv = (
  name: string,
  fallback: StorageBackend,
): StorageBackend => {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  if (!(STORAGE_BACKENDS as readonly string[]).includes(raw)) {
    throw new Error(
      `${name} must be one of ${STORAGE_BACKENDS.join(', ')}, got "${raw}"`,
    );
  }

  return raw as StorageBackend;
};

const parseCronEnv = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim() || fallback;

  if (!validateCronExpression(value).valid) {
    throw new Error(`${name} must be a valid cron expression, got "${value}"`);
  }

  return value;
};

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL ?? 'http://localhost:3001',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtIssuer: process.env.JWT_ISSUER ?? 'file-transfer-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'file-transfer-client',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  jwtAccessExpiresInMs: ms(
    (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as ms.StringValue,
  ),
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  jwtRefreshExpiresInMs: ms(
    (process.env.JWT_REFRESH_EXPIRES_IN ?? '30d') as ms.StringValue,
  ),
  cookie: {
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'app',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },
  mail: {
    host: process.env.MAIL_HOST ?? 'localhost',
    port: parseInt(process.env.MAIL_PORT ?? '1025', 10),
    user: process.env.MAIL_USER ?? '',
    password: process.env.MAIL_PASSWORD ?? '',
    from: process.env.MAIL_FROM ?? 'File Transfer <noreply@localhost>',
    secure: process.env.MAIL_SECURE === 'true',
  },
  rbac: {
    cacheTtlSeconds: parseInt(process.env.RBAC_CACHE_TTL_SECONDS ?? '30', 10),
  },
  swagger: {
    enabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
    path: process.env.SWAGGER_PATH ?? 'docs',
  },
  uploads: {
    dir: process.env.UPLOADS_DIR ?? 'uploads',
    publicPrefix: process.env.UPLOADS_PUBLIC_PREFIX ?? '/static',
    avatarMaxBytes: parseInt(
      process.env.AVATAR_MAX_BYTES ?? String(5 * 1024 * 1024),
      10,
    ),
  },
  conversion: {
    storageDir: process.env.CONVERSION_STORAGE_DIR ?? 'storage/conversions',
    maxSizes: {
      csv: parseIntEnv('CSV_MAX_SIZE', 10 * MB),
      json: parseIntEnv('JSON_MAX_SIZE', 10 * MB),
      xml: parseIntEnv('XML_MAX_SIZE', 10 * MB),
      yaml: parseIntEnv('YAML_MAX_SIZE', 5 * MB),
    },
    timeoutMs: parseIntEnv('CONVERSION_TIMEOUT_MS', 30_000),
    maxDepth: parseIntEnv('CONVERSION_MAX_DEPTH', 100),
    maxNodes: parseIntEnv('CONVERSION_MAX_NODES', 1_000_000),
    maxYamlAliases: parseIntEnv('CONVERSION_MAX_YAML_ALIASES', 100),
    workerThreads: parseIntEnv(
      'CONVERSION_WORKER_THREADS',
      defaultWorkerThreads(),
    ),
    workerMaxHeapMb: parseIntEnv('CONVERSION_WORKER_MAX_HEAP_MB', 512),
  },
  imageConversion: {
    maxSizes: {
      png: parseIntEnv('PNG_MAX_SIZE', 20 * MB),
      jpeg: parseIntEnv('JPEG_MAX_SIZE', 20 * MB),
      svg: parseIntEnv('SVG_MAX_SIZE', 10 * MB),
    },
    maxRasterWidth: parseIntEnv('MAX_RASTER_WIDTH', 4096),
    maxRasterHeight: parseIntEnv('MAX_RASTER_HEIGHT', 4096),
    maxInputPixels: parseIntEnv('IMAGE_MAX_INPUT_PIXELS', 50_000_000),
    timeoutMs: parseIntEnv('IMAGE_CONVERSION_TIMEOUT_MS', 30_000),
    workerThreads: parseIntEnv('IMAGE_WORKER_THREADS', defaultWorkerThreads()),
    workerMaxHeapMb: parseIntEnv('IMAGE_WORKER_MAX_HEAP_MB', 512),
  },
  transformationStorage: {
    backend: parseStorageBackendEnv('STORAGE_BACKEND', 'LOCAL_STORAGE'),
    localDir:
      process.env.TRANSFORMATION_STORAGE_DIR ?? 'storage/transformations',
    retentionDays: parseIntEnv('DEFAULT_RETENTION_DAYS', 90),
    cleanupCron: parseCronEnv('CLEANUP_CRON_SCHEDULE', '0 0 * * *'),
  },
  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '600', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
    resendCooldownSeconds: parseInt(
      process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '60',
      10,
    ),
  },
  login: {
    maxFailedAttempts: parseInt(
      process.env.LOGIN_MAX_FAILED_ATTEMPTS ?? '5',
      10,
    ),
    lockoutSeconds: parseInt(process.env.LOGIN_LOCKOUT_SECONDS ?? '900', 10),
  },
  throttle: {
    ttlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '10', 10),
    blockSeconds: parseInt(process.env.THROTTLE_BLOCK_SECONDS ?? '60', 10),
  },
});
