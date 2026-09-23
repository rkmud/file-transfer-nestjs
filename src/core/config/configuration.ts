import ms from 'ms';

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
}

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
