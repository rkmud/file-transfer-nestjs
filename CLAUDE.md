# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Setup
cp .env.example .env
npm install
npm run docker:up        # starts postgres + mailpit (docker-compose)

# Development
npm run start:dev        # nest start --watch
npm run start:debug

# Build / run
npm run build
npm run start:prod

# Lint / format
npm run lint             # eslint --fix on src/ and test/
npm run format            # prettier --write on src/ and test/

# Tests
npm test                 # jest (rootDir: src, pattern *.spec.ts)
npm run test:watch
npx jest path/to/file.spec.ts   # run a single test file
npx jest -t "test name"          # run tests matching a name

# Migrations (TypeORM, driven by src/database/data-source.ts)
npm run migration:generate --name=SomeName   # diff entities vs DB, generate migration
npm run migration:create --name=SomeName     # empty migration file
npm run migration:run
npm run migration:revert
```

There are currently no `*.spec.ts` files in the repo — `npm test` will report "no tests found" until some are added.

Swagger UI is served at `http://localhost:3000/docs` (path/enable controlled by `SWAGGER_ENABLED`/`SWAGGER_PATH`). All routes are mounted under the global prefix `/api` (set in `main.ts`), so an endpoint decorated `@Controller('auth')` is reachable at `/api/auth/...`.

An MCP Postgres server (`mcp__postgres__query`) is available for running arbitrary SQL against the dev database — selects, inserts/updates/deletes, and other ad hoc queries, useful for inspecting or seeding data and verifying migrations. It's not a replacement for `DatabaseModule`/TypeORM: schema changes (new tables/columns) still go through `migration:generate`/`migration:run`, not manual DDL via MCP.

## Architecture

NestJS 11 + TypeORM (Postgres) API using path alias `@/*` → `src/*`. Top-level layout:

- `src/core/` — app wiring: `app/app.module.ts` (root module, wires `ConfigModule`, `ThrottlerModule`, `DatabaseModule` and the feature modules), `config/configuration.ts` (single typed config factory reading `process.env`, registered via `ConfigModule.forRoot({ load: [configuration] })`; every module reads its slice with `configService.getOrThrow<XConfig>('key')`), `swagger/` (Swagger bootstrap + the `SWAGGER_BEARER_AUTH` constant used by `@ApiBearerAuth()`).
- `src/database/` — `data-source.ts` (CLI data source used by the `typeorm`/`migration:*` npm scripts), `database.module.ts` (app-side `TypeOrmModule.forRootAsync`), `typeorm.config.ts` (shared `buildDataSourceOptions` consumed by both), `migrations/`.
- `src/mail/` — `MailerModule` wrapper (`@nestjs-modules/mailer` + Handlebars); the Handlebars templates live in `src/core/templates/*.hbs` (copied to `dist/` via the `**/*.hbs` asset glob in `nest-cli.json`).
- `src/common/` — cross-cutting helpers shared by feature modules (e.g. the `@NormalizeEmail()` transform used by the auth DTOs).
- `src/modules/` — feature modules: `users`, `auth`, `rbac`.

### Auth flow (`src/modules/auth`)

Registration issues JWT tokens immediately but the account starts unverified; a 6-digit OTP (`issueOtp`/`verifyOtp` on `UsersService`, entity at `src/modules/users/otp.entity.ts`, hashed with bcrypt, TTL/attempts/resend-cooldown from config) is emailed via `MailService`. `POST /auth/verify-email` and `/auth/resend-otp` require a valid access token (`AccessTokenGuard`) but operate on the *unverified* user found via `CurrentUser()` — they are not gated by `isEmailVerified`. Access/refresh tokens are both signed with `JwtService` using the same secret but a different `type` claim (`access`/`refresh`, checked in `AccessTokenGuard` and `refreshTokens()`); there is no separate refresh-token secret or persisted token store. Login uses a constant-time-ish pattern (`DUMMY_PASSWORD_HASH` bcrypt-compared for unknown emails) plus a failed-attempt counter/lockout on the `User` entity (`registerFailedLogin`/`registerSuccessfulLogin` in `UsersService`). `AuthModule` exports `AccessTokenGuard` and `JwtModule` so other modules (notably `rbac`) can reuse them without redeclaring the JWT config.

### RBAC (`src/modules/rbac`)

Custom role/permission/grant system, not a third-party library:

- Entities: `Role`, `Permission` (each with an `actions: string[]`, empty = "any action"), `Grant` (role ↔ permission, with an optional `actions` subset), `UserRole` (user ↔ role).
- `RbacStorageService` loads all roles/permissions/grants/user-roles into in-memory `Map`s and caches them for `RBAC_CACHE_TTL_SECONDS` (`RbacConfigOptions`); `RbacService.can()` reads from that cache. Any admin mutation should call `rbacService.invalidate()`/`reload()` so changes take effect without waiting out the TTL.
- Permission checks are expressed as `"resource@action"` strings (`RBAC_ACTION_SEPARATOR = '@'`) via the `@RbacPermissions(...)` decorator + `RbacGuard`, which run *after* `AccessTokenGuard` (`@UseGuards(AccessTokenGuard, RbacGuard)`) so `RbacGuard` can read `request.user.sub`.
- `RbacAuditService.track()` wraps admin mutations to log both successful changes and rejected ones (4xx) with `actorUserId`/`operation`/`entity`/`entityId` — follow this pattern for any new RBAC-admin endpoint rather than logging ad hoc.
- Admin endpoints live under `/admin/rbac/{roles,permissions,grants,user-roles}` and are seeded by `RBAC_ADMIN_ROLE`/`RBAC_ADMIN_PERMISSIONS` (`rbac.constants.ts`) plus the `SeedRbacAdmin` migration.

### Config pattern

All runtime config goes through `src/core/config/configuration.ts` — add new env vars there (typed interface + default) rather than reading `process.env` directly in services. Feature modules should inject `ConfigService` and call `getOrThrow<XConfig>('sectionKey')` for their slice (see `LoginConfig`, `OtpConfig`, `ThrottleConfig`, `RbacConfigOptions`, `MailConfig`, `SwaggerConfig`).

Env values are parsed through the validating helpers in that file (`parseIntEnv`, `parseBoolEnv`, `parseDurationEnv`, `parseTrustProxyEnv`) — use them for new vars instead of bare `parseInt`/`=== 'true'`, so a malformed value fails at startup rather than silently becoming `NaN` and corrupting downstream logic (e.g. the login lockout threshold). `JWT_SECRET` is enforced non-empty in `AuthModule` when the `JwtModule` is built, so a missing secret fails at boot rather than on the first signed token.

### Module dependency direction

`users` has no internal dependencies and owns both the `User` and `Otp` entities. `auth` imports `users` and `mail`. `rbac` imports `auth` (for `AccessTokenGuard`) and `users`. Keep new feature modules following this direction — lower-level modules (`users`) should not import from higher-level ones (`auth`, `rbac`).
