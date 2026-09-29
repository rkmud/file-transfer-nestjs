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

- `src/core/` — app wiring: `app/app.module.ts` (root module, wires `ConfigModule`, `ThrottlerModule`, `DatabaseModule` and the feature modules), `config/configuration.ts` (single typed config factory reading `process.env`, registered via `ConfigModule.forRoot({ load: [configuration] })`; every module reads its slice with `configService.getOrThrow<XConfig>('key')`), `swagger/` (Swagger bootstrap + the `SWAGGER_COOKIE_AUTH` constant used by `@ApiCookieAuth()`; the document declares an `apiKey`-in-cookie scheme for `access_token`, so "Authorize" in Swagger UI expects the cookie, not a bearer token).
- `src/database/` — `data-source.ts` (CLI data source used by the `typeorm`/`migration:*` npm scripts), `database.module.ts` (app-side `TypeOrmModule.forRootAsync`), `typeorm.config.ts` (shared `buildDataSourceOptions` consumed by both), `migrations/`.
- `src/mail/` — `MailerModule` wrapper (`@nestjs-modules/mailer` + Handlebars); the Handlebars templates live in `src/core/templates/*.hbs` (copied to `dist/` via the `**/*.hbs` asset glob in `nest-cli.json`).
- `src/common/` — cross-cutting helpers shared by feature modules: `auth-token/` holds `AuthTokenModule` (builds the `JwtModule`, provides and exports `AccessTokenGuard`) plus the `@CurrentUser()` decorator; also e.g. the `@NormalizeEmail()` transform used by the auth DTOs.
- `src/modules/` — feature modules: `users`, `auth`, `rbac`, `user-profile`, `conversion`, `transformation-history`.

### Auth flow (`src/modules/auth`)

Registration issues JWT tokens immediately but the account starts unverified; a 6-digit OTP (`issueOtp`/`verifyOtp` on `UsersService`, entity at `src/modules/users/otp.entity.ts`, hashed with bcrypt, TTL/attempts/resend-cooldown from config) is emailed via `MailService`. `POST /auth/verify-email` and `/auth/resend-otp` require a valid access token (`AccessTokenGuard`) but operate on the *unverified* user found via `CurrentUser()` — they are not gated by `isEmailVerified`. Access/refresh tokens are both signed with `JwtService` using the same secret but a different `type` claim (`access`/`refresh`, checked in `AccessTokenGuard` and `refreshTokens()`); there is no separate refresh-token secret or persisted token store. Login uses a constant-time-ish pattern (`DUMMY_PASSWORD_HASH` bcrypt-compared for unknown emails) plus a failed-attempt counter/lockout on the `User` entity (`registerFailedLogin`/`registerSuccessfulLogin` in `UsersService`). Tokens are delivered as httpOnly cookies — `AuthCookieService` sets `access_token`/`refresh_token` with `httpOnly: true`, `sameSite: 'lax'`, `path: '/'` and `secure`/`domain` from the `cookie` config slice — and are not returned in the response body. `AccessTokenGuard` reads the access token from `request.cookies[ACCESS_TOKEN_COOKIE]`, never from an `Authorization` header, so any new protected endpoint is documented with `@ApiCookieAuth(SWAGGER_COOKIE_AUTH)`, not `@ApiBearerAuth()`. The guard and the `JwtModule` live in `src/common/auth-token/` (`AuthTokenModule`), which `auth`, `rbac`, `user-profile`, `conversion` and `transformation-history` import rather than redeclaring the JWT config.

### RBAC (`src/modules/rbac`)

Custom role/permission/grant system, not a third-party library:

- Entities: `Role`, `Permission` (each with an `actions: string[]`, empty = "any action"), `Grant` (role ↔ permission, with an optional `actions` subset), `UserRole` (user ↔ role).
- `RbacStorageService` loads all roles/permissions/grants/user-roles into in-memory `Map`s and caches them for `RBAC_CACHE_TTL_SECONDS` (`RbacConfigOptions`); `RbacService.can()` reads from that cache. Any admin mutation should call `rbacService.invalidate()`/`reload()` so changes take effect without waiting out the TTL.
- Permission checks are expressed as `"resource@action"` strings (`RBAC_ACTION_SEPARATOR = '@'`) via the `@RbacPermissions(...)` decorator + `RbacGuard`, which run *after* `AccessTokenGuard` (`@UseGuards(AccessTokenGuard, RbacGuard)`) so `RbacGuard` can read `request.user.sub`.
- `RbacAuditService.track()` wraps admin mutations to log both successful changes and rejected ones (4xx) with `actorUserId`/`operation`/`entity`/`entityId` — follow this pattern for any new RBAC-admin endpoint rather than logging ad hoc.
- Admin endpoints live under `/admin/rbac/{roles,permissions,grants,user-roles}` and are seeded by `RBAC_ADMIN_ROLE`/`RBAC_ADMIN_PERMISSIONS` (`rbac.constants.ts`) plus the `SeedRbacAdmin` migration.

### Text file conversion (`src/modules/conversion`)

`POST /convert` (multipart `file` + `targetFormat`) and `GET /convert/formats`, guarded by `AccessTokenGuard`. Converts between CSV/JSON/XML/YAML:

- `formats/` is pure, Nest-free code that also runs inside worker threads (keep its imports relative, no `@/` alias). Each format is a `TextFormatHandler` subclass (`sniff`/`parse`/`serialize`) registered in `createFormatRegistry()`; adding a format means adding a handler there, a `TEXT_FORMATS` entry and a `*_MAX_SIZE` config key.
- Multer streams uploads to `<CONVERSION_STORAGE_DIR>/incoming`; `TextConversionService` detects the source format (extension + content sniff), enforces the per-format size limit, then runs `worker/conversion.worker.ts` on a Piscina pool (`ConversionWorkerPool`, timeout → 408). The worker writes `<id>.<ext>.part`, which is renamed only on success, so partial results are never served. The storage dir must stay outside `UPLOADS_DIR`, which is publicly served.
- Every request that has a file and target format gets a `conversions` row (`PROCESSING` → `SUCCESS`/`ERROR` + HTTP `error_code`). The row also carries `type` (`ConversionType`: `file` | `image`, default `file`) so the same history table can serve the upcoming image transformation pipeline; text conversions set it explicitly in `TextConversionService`, and any new pipeline must set its own value. Logs carry metadata only, never file content; parser error messages go to the client but not to logs.

### Image conversion (`src/modules/conversion`, `images/`)

`POST /images/convert` (multipart `file` + `targetFormat` + optional `quality`/`width`/`height`/`background`) and `GET /images/convert/formats`, served by `ImageConversionController` in the same `ConversionModule` (shared Multer config, `ConversionStorage` and `conversions` table with `type = image`). PNG ↔ JPEG and SVG → PNG/JPEG via `sharp`; vectorization (→ SVG) is rejected with 400 `VECTORIZATION_NOT_SUPPORTED`:

- `images/` is pure, worker-safe code like `formats/` (relative imports only). Each format is an `ImageFormatHandler`; encodable ones extend `RasterFormatHandler`. `ImageFormatRegistry.targetsFor()`/`resolveTarget()` derive the allowed directions (any raster target other than the source), so adding a raster codec means a handler in `createImageFormatRegistry()`, an `IMAGE_FORMATS` entry and a `*_MAX_SIZE` key in the `imageConversion` config slice.
- The source format is decided by the file signature; a known extension/MIME type that contradicts it, or an unknown extension, is 415. Raster inputs are rejected from header dimensions above `IMAGE_MAX_INPUT_PIXELS` before decoding. SVGs go through `sanitizeSvg()` (strips DOCTYPE/entities, scripts, `on*` handlers, animation, `foreignObject`, and every non-`#`/non-`data:image` reference or `url()`), which also rewrites the root size for rendering at 72 DPI.
- Work runs in `worker/image.worker.ts` on `ImageWorkerPool` (shares the generic `WorkerPool` base with `ConversionWorkerPool`; `sharp` is imported in the main thread first on purpose). Failures carry an `ImageConversionErrorCode`, returned to the client as `code` and stored in the `error_reason` column next to the HTTP `error_code`.

### Transformation history (`src/modules/transformation-history`)

`GET /transformations/history` (own history, `AccessTokenGuard`), `GET /admin/transformations/history` (optional `userId` filter) and `GET /admin/users/:userId/transformations/history`, the admin ones gated by `transformations.history@admin` (seeded for the `admin` role by `SeedTransformationsHistoryPermission`). All are cursor-paginated newest first, with `type`/`sourceFormat`/`targetFormat`/`status`/`createdAtFrom`/`createdAtTo` filters and a `{ items, pageInfo: { limit, hasMore, nextCursor } }` response:

- Records live in `transformation_logs`, one row per *finished* conversion, keyed by the same id as its `conversions` row. Both conversion services call `TransformationHistoryService.record(toTransformationLog(record))` at the end of `complete()`; `record()` upserts and never throws, so a history failure doesn't fail the conversion. A new pipeline must do the same.
- `error_code` is a machine-readable string: the `ImageConversionErrorCode`/`ConversionErrorCode`, `TIMEOUT`, or one derived from the HTTP status (`FILE_TOO_LARGE`, `UNSUPPORTED_FORMAT`); the text pipeline now also stores it in `conversions.error_reason`. `source_format` is `unknown` when the conversion failed before detection, and `source_file_path` is null when the input was never stored.
- The cursor is Base64URL JSON `{ createdAt, id }`, with `createdAt` taken from `to_char(... 'US')` so microsecond timestamps round-trip exactly; the keyset uses a row comparison `(created_at, id) < (...)`, which matches the `DESC` composite indexes created in `CreateTransformationLogs` (declared on the entity with `synchronize: false`).

### Transformation storage (`src/modules/transformation-history`, 012)

Both convert endpoints accept an optional multipart `save` boolean (`@ParseBoolean()` from `src/common/decorators`). On success with `save=true` the conversion service fires `TransformationFileService.persist()` *without awaiting* it, after `complete()` has recorded the history row. It re-reads the committed conversion output and copies it into transformation storage, so storage I/O never delays or fails the response:

- `storage/StorageService` is the pluggable, key-based backend abstraction (`put`/`stat`/`openRead`/`delete`). `LocalStorageService` (root `TRANSFORMATION_STORAGE_DIR`, default `storage/transformations`, which must stay outside `UPLOADS_DIR`) is picked by the factory in `TransformationHistoryModule` from `STORAGE_BACKEND`. A new backend means a `STORAGE_BACKENDS` entry plus a `case` in that factory. Keys are `{YYYY-MM-DD}/{userId}/{itemId}_{targetFormat}.{ext}`, dated from `createdAt` in UTC. Writes go to a `.part` file that is renamed only on success.
- `transformation_logs` gains `is_stored`, `storage_path`, `expires_at` and `storage_error_code` (`AddTransformationLogStorage`). `expires_at = createdAt + DEFAULT_RETENTION_DAYS` is set only by a successful save and is kept after the purge. That gives downloads this rule: no `expires_at` → 404 (never saved, still saving, or the save failed, which sets `storage_error_code` `STORAGE_FULL`/`STORAGE_WRITE_FAILED`); `expires_at` set but expired/purged/missing on disk → 410.
- Downloads: `GET /transformations/history/:itemId/download` (owner only; another user's item is 403, per spec) and `GET /admin/transformations/history/:itemId/download` / `GET /admin/users/:userId/transformations/history/:itemId/download` (`transformations.history@admin`; the item must belong to `userId`, else 404). The file is streamed as `transformed_<itemId>.<ext>` with the MIME type from `TRANSFORMATION_MIME_TYPES`.
- `TransformationStorageCleanupScheduler` registers a `cron` job (via `@nestjs/schedule`'s `SchedulerRegistry`, `ScheduleModule.forRoot()` in `AppModule`) on `CLEANUP_CRON_SCHEDULE` in UTC. It calls `purgeExpired()`, which walks `is_stored AND expires_at <= now()` in keyset batches, deletes each file, and clears `is_stored`/`storage_path`. Rows whose delete failed stay stored and are retried on the next run. It logs `purgedFilesCount`/`freedSpaceBytes`. `@nestjs/schedule` is pinned to 6.x: 12.x is ESM-only and targets Nest 12.

### Config pattern

All runtime config goes through `src/core/config/configuration.ts` — add new env vars there (typed interface + default) rather than reading `process.env` directly in services. Feature modules should inject `ConfigService` and call `getOrThrow<XConfig>('sectionKey')` for their slice (see `LoginConfig`, `OtpConfig`, `ThrottleConfig`, `RbacConfigOptions`, `MailConfig`, `SwaggerConfig`).

New env values should be parsed through the validating `parseIntEnv` helper in that file (older vars still use bare `parseInt`) — use it for new vars instead of bare `parseInt`/`=== 'true'`, so a malformed value fails at startup rather than silently becoming `NaN` and corrupting downstream logic (e.g. the login lockout threshold). `JWT_SECRET` has no default: `configuration.ts` reads it through the `requireEnv` helper (throws on missing/empty) and `AuthTokenModule` reads it with `config.getOrThrow()`, so a missing secret fails at boot instead of signing tokens with an empty key. Use `requireEnv` for any other env var that must not have a fallback.

### Module dependency direction

`users` has no internal dependencies and owns both the `User` and `Otp` entities. `AuthTokenModule` (`src/common/auth-token`) sits below the feature modules and is imported by everything that needs `AccessTokenGuard` — `auth`, `rbac`, `user-profile`, `conversion`, `transformation-history`. `conversion` imports `transformation-history` (never the reverse), so the history module keeps its own MIME map instead of importing the conversion format registries. `auth` imports `users`, `mail` and `rbac`. Keep new feature modules following this direction — lower-level modules (`users`) should not import from higher-level ones (`auth`, `rbac`).
