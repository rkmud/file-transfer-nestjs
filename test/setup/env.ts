export const TEST_JWT_SECRET = 'test-only-jwt-secret-do-not-use-in-production';

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_JWT_SECRET,
  JWT_ISSUER: 'file-transfer-api',
  JWT_AUDIENCE: 'file-transfer-client',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
  SWAGGER_ENABLED: 'false',
  THROTTLE_LIMIT: '1000',
  THROTTLE_TTL_SECONDS: '60',
  THROTTLE_BLOCK_SECONDS: '60',
  CONVERSION_WORKER_THREADS: '1',
  IMAGE_WORKER_THREADS: '1',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] = value;
}

for (const key of [
  'COOKIE_SECURE',
  'COOKIE_DOMAIN',
  'STORAGE_BACKEND',
  'CLEANUP_CRON_SCHEDULE',
  'CONVERSION_STREAM_THRESHOLD_BYTES',
]) {
  delete process.env[key];
}
