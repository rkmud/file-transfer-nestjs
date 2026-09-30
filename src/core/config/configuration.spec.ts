import { availableParallelism } from 'os';
import configuration, { STORAGE_BACKENDS } from './configuration';

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  availableParallelism: jest.fn(() => 8),
}));

const cpuCount = availableParallelism as jest.MockedFunction<
  typeof availableParallelism
>;

const MB = 1024 * 1024;

describe('configuration', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
    cpuCount.mockReturnValue(8);
  });

  const setEnv = (vars: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  /** Keep only JWT_SECRET so every optional var falls back to its default. */
  const bareEnv = (extra: Record<string, string> = {}) => {
    process.env = { JWT_SECRET: 'secret', ...extra };
  };

  describe('requireEnv (JWT_SECRET)', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['whitespace-only', '   \t '],
    ])('throws when JWT_SECRET is %s', (_label, value) => {
      setEnv({ JWT_SECRET: value });

      expect(() => configuration()).toThrow(
        'JWT_SECRET must be set to a non-empty value',
      );
    });

    it('returns the trimmed secret', () => {
      setEnv({ JWT_SECRET: '  s3cret  ' });

      expect(configuration().jwtSecret).toBe('s3cret');
    });
  });

  describe('parseIntEnv', () => {
    it.each(['abc', '12abc', '1.5', '0', '-5', '1e400', '9007199254740993'])(
      'rejects malformed / non-positive value %p at startup',
      (raw) => {
        setEnv({ CSV_MAX_SIZE: raw });

        expect(() => configuration()).toThrow(
          `CSV_MAX_SIZE must be a positive integer, got "${raw}"`,
        );
      },
    );

    it.each([
      ['DEFAULT_RETENTION_DAYS', 'NaN'],
      ['CONVERSION_TIMEOUT_MS', '-1'],
      ['IMAGE_MAX_INPUT_PIXELS', '0'],
    ])('never yields NaN/zero for %s=%p', (name, raw) => {
      setEnv({ [name]: raw });

      expect(() => configuration()).toThrow(name);
    });

    it('parses a valid positive integer (surrounding whitespace allowed)', () => {
      setEnv({ CSV_MAX_SIZE: ' 2048 ', DEFAULT_RETENTION_DAYS: '7' });

      const config = configuration();

      expect(config.conversion.maxSizes.csv).toBe(2048);
      expect(config.transformationStorage.retentionDays).toBe(7);
    });

    it.each(['', '   '])(
      'falls back to the default for blank value %p',
      (raw) => {
        setEnv({ CSV_MAX_SIZE: raw });

        expect(configuration().conversion.maxSizes.csv).toBe(10 * MB);
      },
    );
  });

  describe('defaults for optional vars', () => {
    it('applies every documented default when only JWT_SECRET is set', () => {
      bareEnv();
      cpuCount.mockReturnValue(8);

      const config = configuration();

      expect(config).toMatchObject({
        nodeEnv: 'development',
        port: 3000,
        appUrl: 'http://localhost:3001',
        jwtSecret: 'secret',
        jwtIssuer: 'file-transfer-api',
        jwtAudience: 'file-transfer-client',
        jwtAccessExpiresIn: '15m',
        jwtAccessExpiresInMs: 15 * 60_000,
        jwtRefreshExpiresIn: '30d',
        jwtRefreshExpiresInMs: 30 * 24 * 3600_000,
        cookie: { secure: false, domain: undefined },
        database: {
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: 'postgres',
          database: 'app',
          synchronize: false,
          logging: false,
        },
        mail: {
          host: 'localhost',
          port: 1025,
          user: '',
          password: '',
          from: 'File Transfer <noreply@localhost>',
          secure: false,
        },
        rbac: { cacheTtlSeconds: 30 },
        swagger: { enabled: true, path: 'docs' },
        uploads: {
          dir: 'uploads',
          publicPrefix: '/static',
          avatarMaxBytes: 5 * MB,
        },
        conversion: {
          storageDir: 'storage/conversions',
          maxSizes: { csv: 10 * MB, json: 10 * MB, xml: 10 * MB, yaml: 5 * MB },
          streamThresholdBytes: MB,
          timeoutMs: 30_000,
          maxDepth: 100,
          maxNodes: 1_000_000,
          maxYamlAliases: 100,
          workerThreads: 4,
          workerMaxHeapMb: 512,
        },
        imageConversion: {
          maxSizes: { png: 20 * MB, jpeg: 20 * MB, svg: 10 * MB },
          maxRasterWidth: 4096,
          maxRasterHeight: 4096,
          maxInputPixels: 50_000_000,
          timeoutMs: 30_000,
          workerThreads: 4,
          workerMaxHeapMb: 512,
        },
        transformationStorage: {
          backend: 'LOCAL_STORAGE',
          localDir: 'storage/transformations',
          retentionDays: 90,
          cleanupCron: '0 0 * * *',
        },
        otp: { ttlSeconds: 600, maxAttempts: 5, resendCooldownSeconds: 60 },
        login: { maxFailedAttempts: 5, lockoutSeconds: 900 },
        throttle: { ttlSeconds: 60, limit: 10, blockSeconds: 60 },
      });
    });

    it.each([
      [1, 1],
      [2, 1],
      [3, 2],
      [16, 4],
    ])(
      'default worker threads = clamp(cpus-1, 1, 4): %i cpus -> %i',
      (cpus, expected) => {
        bareEnv();
        cpuCount.mockReturnValue(cpus);

        const config = configuration();

        expect(config.conversion.workerThreads).toBe(expected);
        expect(config.imageConversion.workerThreads).toBe(expected);
      },
    );

    it('reads explicit values for optional vars', () => {
      bareEnv({
        NODE_ENV: 'staging',
        PORT: '8080',
        APP_URL: 'https://app.example.com',
        JWT_ACCESS_EXPIRES_IN: '5m',
        JWT_REFRESH_EXPIRES_IN: '1d',
        COOKIE_DOMAIN: 'example.com',
        DB_SYNCHRONIZE: 'true',
        DB_LOGGING: 'true',
        MAIL_SECURE: 'true',
        SWAGGER_ENABLED: 'false',
        CONVERSION_WORKER_THREADS: '2',
        IMAGE_WORKER_THREADS: '3',
        THROTTLE_LIMIT: '7',
      });

      const config = configuration();

      expect(config.nodeEnv).toBe('staging');
      expect(config.port).toBe(8080);
      expect(config.appUrl).toBe('https://app.example.com');
      expect(config.jwtAccessExpiresInMs).toBe(5 * 60_000);
      expect(config.jwtRefreshExpiresInMs).toBe(24 * 3600_000);
      expect(config.cookie.domain).toBe('example.com');
      expect(config.database.synchronize).toBe(true);
      expect(config.database.logging).toBe(true);
      expect(config.mail.secure).toBe(true);
      expect(config.swagger.enabled).toBe(false);
      expect(config.conversion.workerThreads).toBe(2);
      expect(config.imageConversion.workerThreads).toBe(3);
      expect(config.throttle.limit).toBe(7);
    });

    it('treats an empty COOKIE_DOMAIN as undefined', () => {
      bareEnv({ COOKIE_DOMAIN: '' });

      expect(configuration().cookie.domain).toBeUndefined();
    });
  });

  describe('cookie.secure', () => {
    it.each([
      [undefined, 'production', true],
      [undefined, 'development', false],
      [undefined, undefined, false],
      ['true', 'development', true],
      ['false', 'production', false],
      ['yes', 'production', false],
      ['', 'production', true],
    ])(
      'COOKIE_SECURE=%p NODE_ENV=%p -> %p',
      (cookieSecure, nodeEnv, expected) => {
        bareEnv();
        setEnv({ COOKIE_SECURE: cookieSecure, NODE_ENV: nodeEnv });

        expect(configuration().cookie.secure).toBe(expected);
      },
    );
  });

  describe('STORAGE_BACKEND', () => {
    it.each(STORAGE_BACKENDS)('accepts %s', (backend) => {
      setEnv({ STORAGE_BACKEND: ` ${backend} ` });

      expect(configuration().transformationStorage.backend).toBe(backend);
    });

    it.each(['', '  '])('falls back to LOCAL_STORAGE for %p', (raw) => {
      setEnv({ STORAGE_BACKEND: raw });

      expect(configuration().transformationStorage.backend).toBe(
        'LOCAL_STORAGE',
      );
    });

    it.each(['S3', 'local_storage'])('rejects unknown backend %p', (raw) => {
      setEnv({ STORAGE_BACKEND: raw });

      expect(() => configuration()).toThrow(
        `STORAGE_BACKEND must be one of LOCAL_STORAGE, got "${raw}"`,
      );
    });
  });

  describe('CLEANUP_CRON_SCHEDULE', () => {
    it('accepts a valid cron expression', () => {
      setEnv({ CLEANUP_CRON_SCHEDULE: ' */15 3 * * 1 ' });

      expect(configuration().transformationStorage.cleanupCron).toBe(
        '*/15 3 * * 1',
      );
    });

    it.each(['', '   '])('falls back to the daily default for %p', (raw) => {
      setEnv({ CLEANUP_CRON_SCHEDULE: raw });

      expect(configuration().transformationStorage.cleanupCron).toBe(
        '0 0 * * *',
      );
    });

    it.each(['not a cron', '99 99 * * *'])('rejects invalid %p', (raw) => {
      setEnv({ CLEANUP_CRON_SCHEDULE: raw });

      expect(() => configuration()).toThrow(
        `CLEANUP_CRON_SCHEDULE must be a valid cron expression, got "${raw}"`,
      );
    });
  });
});
