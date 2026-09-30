import {
  DynamicModule,
  Global,
  INestApplication,
  Module,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import { mkdirSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { configureApp } from '@/core/app/app.setup';
import { createThrottlerOptions } from '@/core/app/throttler.options';
import configuration from '@/core/config/configuration';
import { HealthModule } from '@/core/health/health.module';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TYPE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_TYPE,
} from '@/modules/auth/auth.constants';
import { AuthModule } from '@/modules/auth/auth.module';
import { ConversionModule } from '@/modules/conversion/conversion.module';
import { Conversion } from '@/modules/conversion/entities/conversion.entity';
import { ConversionWorkerPool } from '@/modules/conversion/services/conversion-worker-pool.service';
import runConversionTask from '@/modules/conversion/worker/conversion.worker';
import runImageTask from '@/modules/conversion/worker/image.worker';
import { ImageWorkerPool } from '@/modules/conversion/services/image-worker-pool.service';
import { Grant } from '@/modules/rbac/entities/grant.entity';
import { Permission } from '@/modules/rbac/entities/permission.entity';
import { Role } from '@/modules/rbac/entities/role.entity';
import { UserRole } from '@/modules/rbac/entities/user-role.entity';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { RbacService } from '@/modules/rbac/rbac.service';
import { TransformationLog } from '@/modules/transformation-history/entities/transformation-log.entity';
import { TransformationHistoryModule } from '@/modules/transformation-history/transformation-history.module';
import { UserProfileModule } from '@/modules/user-profile/user-profile.module';
import { Otp } from '@/modules/users/otp.entity';
import { User } from '@/modules/users/users.entity';
import { UsersModule } from '@/modules/users/users.module';
import { InMemoryDatabase } from './in-memory-database';
import { InMemoryRepository } from './in-memory-repository';
import { MailRecorder } from './mail-recorder';
import { InProcessWorkerPool } from './worker-pools';
import { makeTempDir, removeDir } from './temp-dir';
import { TEST_PASSWORD, TEST_PASSWORD_HASH } from './credentials';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ALL_ENTITIES: (new () => unknown)[] = [
  User,
  Otp,
  Role,
  Permission,
  Grant,
  UserRole,
  Conversion,
  TransformationLog,
];

export const ALL_FEATURE_MODULES = [
  HealthModule,
  UsersModule,
  AuthModule,
  RbacModule,
  UserProfileModule,
  ConversionModule,
  TransformationHistoryModule,
];

export interface TestAppOptions {
  imports?: any[];
  env?: Record<string, string | undefined>;
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export interface SeedUserOptions extends Partial<User> {
  roles?: string[];
  permissions?: string[];
}

export interface TestApp {
  app: INestApplication;
  module: TestingModule;
  db: InMemoryDatabase;
  mail: MailRecorder;
  conversionPool: InProcessWorkerPool;
  imagePool: InProcessWorkerPool;
  tempDir: string;
  dirs: { conversions: string; transformations: string; uploads: string };
  http(): ReturnType<typeof request>;
  get<T>(token: any): T;
  repo<T>(entity: new () => T): InMemoryRepository<T>;
  reset(): Promise<void>;
  seedAdmin(options?: SeedUserOptions): Promise<User>;
  close(): Promise<void>;
  seedUser(options?: SeedUserOptions): Promise<User>;
  grant(roleName: string, permissions: string[]): Promise<Role>;
  assignRole(userId: string, roleName: string): Promise<void>;
  accessToken(
    user: Pick<User, 'id' | 'email'>,
    claims?: Record<string, unknown>,
  ): string;
  refreshToken(
    user: Pick<User, 'id' | 'email'>,
    claims?: Record<string, unknown>,
  ): string;
  authCookie(user: Pick<User, 'id' | 'email'>): string;
  refreshCookie(user: Pick<User, 'id' | 'email'>): string;
}

@Global()
@Module({})
class TestDatabaseModule {
  static register(dataSource: DataSource): DynamicModule {
    return {
      module: TestDatabaseModule,
      providers: [{ provide: DataSource, useValue: dataSource }],
      exports: [DataSource],
    };
  }
}

export const createTestApp = async (
  options: TestAppOptions = {},
): Promise<TestApp> => {
  const tempDir = makeTempDir('ftn-app-');
  const dirs = {
    conversions: join(tempDir, 'conversions'),
    transformations: join(tempDir, 'transformations'),
    uploads: join(tempDir, 'uploads'),
  };

  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

  const env: Record<string, string | undefined> = {
    CONVERSION_STORAGE_DIR: dirs.conversions,
    TRANSFORMATION_STORAGE_DIR: dirs.transformations,
    UPLOADS_DIR: dirs.uploads,
    ...options.env,
  };
  const previousEnv = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const restoreEnv = () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  const db = new InMemoryDatabase();
  const mail = new MailRecorder();
  const conversionPool = new InProcessWorkerPool(() => runConversionTask);
  const imagePool = new InProcessWorkerPool(() => runImageTask);

  let builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [configuration],
      }),
      ThrottlerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: createThrottlerOptions,
      }),
      ScheduleModule.forRoot(),
      TestDatabaseModule.register(db.asDataSource()),
      ...(options.imports ?? ALL_FEATURE_MODULES),
    ],
  })
    .overrideProvider(MailerService)
    .useValue(mail)
    .overrideProvider(ConversionWorkerPool)
    .useValue(conversionPool)
    .overrideProvider(ImageWorkerPool)
    .useValue(imagePool);

  for (const entity of ALL_ENTITIES) {
    builder = builder
      .overrideProvider(getRepositoryToken(entity))
      .useValue(db.repo(entity));
  }

  if (options.override) builder = options.override(builder);

  let module: TestingModule;

  try {
    module = await builder.compile();
  } catch (error) {
    restoreEnv();
    removeDir(tempDir);
    throw error;
  }

  const app = configureApp(module.createNestApplication({ logger: false }));

  seedBaseline(db);
  await app.init();

  const jwt = () => module.get(JwtService);
  const sign = (
    user: Pick<User, 'id' | 'email'>,
    type: string,
    claims: Record<string, unknown> = {},
  ) => jwt().sign({ sub: user.id, email: user.email, type, ...claims });

  const testApp: TestApp = {
    app,
    module,
    db,
    mail,
    conversionPool,
    imagePool,
    tempDir,
    dirs,
    http: () => request(app.getHttpServer()),
    get: <T>(token: any) => module.get<T>(token, { strict: false }),
    repo: (entity) => db.repo(entity),
    async reset() {
      db.reset();
      mail.reset();
      conversionPool.reset();
      imagePool.reset();
      seedBaseline(db);
      safeRbacInvalidate(module);
      module
        .get<{ storage: Map<string, unknown> }>(ThrottlerStorage, {
          strict: false,
        })
        .storage.clear();
    },
    seedAdmin: (options = {}) =>
      testApp.seedUser({
        ...options,
        roles: [BASELINE_ADMIN_ROLE, ...(options.roles ?? [])],
      }),
    async close() {
      try {
        await app.close();
      } finally {
        restoreEnv();
        removeDir(tempDir);
      }
    },
    async seedUser({ roles = [], permissions = [], ...fields } = {}) {
      const [user] = db.repo(User).seed({
        email: `user${db.repo(User).all().length + 1}@example.com`,
        password: TEST_PASSWORD_HASH,
        firstName: 'Test',
        lastName: 'User',
        isEmailVerified: true,
        ...fields,
      });

      for (const role of roles) await testApp.assignRole(user.id, role);

      if (permissions.length > 0) {
        const roleName = `perm-role-${user.id}`;

        await testApp.grant(roleName, permissions);
        await testApp.assignRole(user.id, roleName);
      }

      return user;
    },
    async grant(roleName, permissionStrings) {
      const role = ensureRole(db, roleName);

      for (const entry of permissionStrings) {
        const [name, action] = entry.split('@');
        const permissions = db.repo(Permission);
        const permission =
          permissions.all().find((p) => p.name === name) ??
          permissions.seed({ name, actions: [] })[0];
        const grants = db.repo(Grant);
        const existing = grants
          .all()
          .find(
            (g) => g.roleId === role.id && g.permissionId === permission.id,
          );

        if (existing) {
          existing.actions =
            action && existing.actions ? [...existing.actions, action] : null;
        } else {
          grants.seed({
            roleId: role.id,
            permissionId: permission.id,
            actions: action ? [action] : null,
          });
        }
      }

      safeRbacInvalidate(module);

      return role;
    },
    async assignRole(userId, roleName) {
      const role = ensureRole(db, roleName);
      const userRoles = db.repo(UserRole);

      if (
        !userRoles
          .all()
          .some((ur) => ur.userId === userId && ur.roleId === role.id)
      ) {
        userRoles.seed({ userId, roleId: role.id });
      }

      safeRbacInvalidate(module);
    },
    accessToken: (user, claims) => sign(user, ACCESS_TOKEN_TYPE, claims),
    refreshToken: (user, claims) => sign(user, REFRESH_TOKEN_TYPE, claims),
    authCookie: (user) =>
      `${ACCESS_TOKEN_COOKIE}=${sign(user, ACCESS_TOKEN_TYPE)}`,
    refreshCookie: (user) =>
      `${REFRESH_TOKEN_COOKIE}=${sign(user, REFRESH_TOKEN_TYPE)}`,
  };

  return testApp;
};

export const BASELINE_ADMIN_ROLE = 'admin';
export const BASELINE_USER_ROLE = 'user';

export const BASELINE_PERMISSIONS: Record<string, string[]> = {
  rbac: ['read', 'create', 'update', 'delete'],
  users: ['read', 'update', 'delete', 'list'],
  'transformations.history': ['admin'],
};

const seedBaseline = (db: InMemoryDatabase): void => {
  const admin = ensureRole(db, BASELINE_ADMIN_ROLE);

  ensureRole(db, BASELINE_USER_ROLE);

  for (const [name, actions] of Object.entries(BASELINE_PERMISSIONS)) {
    const [permission] = db.repo(Permission).seed({ name, actions });

    db.repo(Grant).seed({
      roleId: admin.id,
      permissionId: permission.id,
      actions: [...actions],
    });
  }
};

const ensureRole = (db: InMemoryDatabase, name: string): Role => {
  const roles = db.repo(Role);

  return roles.all().find((r) => r.name === name) ?? roles.seed({ name })[0];
};

const safeRbacInvalidate = (module: TestingModule): void => {
  try {
    module.get(RbacService, { strict: false }).invalidate();
  } catch {
    // RBAC module not mounted in this app.
  }
};

export { TEST_PASSWORD };
