# Technical Specification: Automated Test Coverage (013-test-flow)

## 1. Overview and Architectural Principles

### 1.1 Purpose
This specification defines the mandatory automated test suite for the platform. It fixes the coverage target, the test taxonomy (unit and integration), the runner layout, the harness rules, and the per-feature scenario checklist that the suite must satisfy.

The document is **derived from the existing feature specifications** in `docs/requirements/` (`002`–`012`). Those documents remain the single source of truth for behaviour: every endpoint, status code, error code, limit and state transition they define is the input for the scenarios in section 5. This specification does not introduce or change product behaviour — it only states how that behaviour must be verified.

### 1.2 Coverage Target
* **Global coverage target: ≥ 90%.**
* This supersedes the `Test coverage ≥ 80%` non-functional requirement in `docs/TASK.md`. `80%` is the contractual minimum; `90%` is the enforced project gate.

### 1.3 Key Architectural Principles
* **Specification-Driven Scenarios:** Each test case traces back to a numbered requirement document. A feature specification is considered covered only when both its happy paths and its documented failure paths (status codes, error codes, limits) are asserted.
* **No External Infrastructure:** The suite runs with **no PostgreSQL, no SMTP server and no Docker**. `npm test` must pass on a clean checkout after `npm install`, with no `docker:up` and no `.env` beyond the test defaults. Persistence, mail and any other I/O boundary are replaced by test doubles.
* **Two Layers, One Gate:** Unit tests isolate a single class or pure module; integration tests wire a real Nest module graph (controller + pipes + guards + interceptors + service) and drive it over HTTP. Both layers contribute to one merged coverage report checked against one threshold.
* **Determinism:** No wall-clock dependence, no random ports, no network, no sleeps, no cross-test shared mutable state. Time-dependent logic (OTP TTL, lockout windows, RBAC cache TTL, retention `expiresAt`, cleanup cron) is driven by injected or faked clocks.
* **Pure Modules Tested Directly:** The Nest-free code under `src/modules/conversion/formats/` and `src/modules/conversion/images/` is exercised by unit tests without any Nest testing module, matching the way it runs inside worker threads.

---

## 2. Coverage Requirements

### 2.1 Threshold

Coverage is enforced by Jest's `coverageThreshold.global`. All four metrics are gated at the same level:

| Metric | Minimum |
| :--- | :--- |
| `statements` | 90% |
| `branches` | 90% |
| `functions` | 90% |
| `lines` | 90% |

A run below any threshold **fails** — the gate is a non-zero exit code from the test command, not a report to read.

### 2.2 Measured Scope

Coverage is collected from `src/**/*.ts` with the following exclusions. The exclusions are deliberate: they hold declarative wiring with no branching logic, and counting them would let generated boilerplate inflate the percentage.

| Excluded | Pattern | Reason |
| :--- | :--- | :--- |
| Bootstrap | `src/main.ts` | Process bootstrap; exercised only by starting the real server. |
| Nest module wiring | `src/**/*.module.ts` | Declarative provider/import lists. |
| DTOs and entities | `src/**/dto/**`, `src/**/*.entity.ts` | Decorator metadata; validation behaviour is asserted through the endpoints that use them. |
| Migrations and data source | `src/database/migrations/**`, `src/database/data-source.ts` | CLI-only; schema correctness is a migration concern, not a unit-test concern. |
| Swagger bootstrap | `src/core/swagger/**` | Document assembly, no domain logic. |
| Type-only files | `src/**/*.types.ts`, `src/**/*.constants.ts` | No executable statements. |
| Test helpers | `test/**` | The harness itself. |

Everything else is in scope, in particular: services, guards, custom decorators and pipes, controllers, config factory (`configuration.ts`, including `parseIntEnv`/`requireEnv`), format and image handlers, detectors, sanitizers, record streams, worker task entry points, storage backends and the cleanup scheduler.

### 2.3 Reporting
* Reporters: `text-summary` (console) and `lcov` + `html` (written to `coverage/`).
* The merged report covers both layers in a single run; a file reached only by an integration test counts the same as one reached by a unit test.
* `coverage/` is git-ignored.

---

## 3. Test Layout and Execution

### 3.1 Directory Layout

```
src/
└── modules/auth/auth.service.spec.ts        # unit: co-located with the code under test
test/
├── setup/                                    # harness: app factory, repository doubles, clock
├── fixtures/                                 # sample csv/json/xml/yaml/png/jpeg/svg payloads
└── integration/
    └── auth.e2e-spec.ts                      # integration: one file per feature specification
```

* **Unit tests** live next to their subject as `*.spec.ts` under `src/`.
* **Integration tests** live under `test/integration/` as `*.e2e-spec.ts` and never under `src/`.
* Integration test files are named after the requirement document they verify (`auth`, `rbac`, `users`, `conversion`, `image-conversion`, `transformation-history`, `transformation-storage`).

### 3.2 Runner Configuration

A root Jest configuration declares both layers as `projects`, so a single run produces one merged coverage report gated by one threshold:

| Project | `rootDir` | `testRegex` | Module alias |
| :--- | :--- | :--- | :--- |
| `unit` | `src` | `.*\.spec\.ts$` | `^@/(.*)$` → `<rootDir>/$1` |
| `integration` | project root | `test/.*\.e2e-spec\.ts$` | `^@/(.*)$` → `<rootDir>/src/$1` |

### 3.3 npm Scripts

| Script | Behaviour |
| :--- | :--- |
| `npm test` | Runs both projects. |
| `npm run test:unit` | Unit project only (`--selectProjects unit`). |
| `npm run test:integration` | Integration project only (`--selectProjects integration`). |
| `npm run test:watch` | Watch mode. |
| `npm run test:cov` | Both projects with `--coverage`; this is the command that enforces section 2.1. |

---

## 4. Integration Test Harness

### 4.1 Application Assembly
* Integration tests build the application with `@nestjs/testing`'s `Test.createTestingModule`, importing the feature module under test plus the modules it genuinely depends on.
* The assembled app must reproduce the production request pipeline: global prefix `/api`, `cookie-parser`, the global `ValidationPipe` (whitelist + transform) and the same exception filters. A test that bypasses the pipeline is not an integration test.
* Requests are issued with `supertest` against the in-memory HTTP adapter. No port is bound.

### 4.2 Persistence Doubles
* **No database is started.** `TypeOrmModule`'s repository providers are replaced through `overrideProvider(getRepositoryToken(Entity))` with in-memory doubles; a `DataSource` double is supplied where a service uses the query builder or transactions.
* Doubles are created fresh per test file and reset between test cases, so no ordering dependency can form.
* Consequence, to be stated explicitly in review: **raw SQL is not verified by this suite.** Keyset pagination SQL, `to_char(... 'US')` cursor formatting, index usage and migration correctness are asserted at the level of the query the service builds (arguments passed to the repository/query-builder double), not against a real engine. Any defect class that only a real engine can catch is out of scope for `013` and must be covered by manual verification or a later specification.

### 4.3 External Boundary Doubles

| Boundary | Test double |
| :--- | :--- |
| `MailService` / SMTP | Mocked provider recording `(to, template, context)`; asserting the OTP was emailed means asserting on this recorder. No SMTP connection is opened. |
| JWT | Real `JwtService` with a fixed test secret, so cookies are genuinely signed and `AccessTokenGuard` runs unmodified. |
| Worker pools (`ConversionWorkerPool`, `ImageWorkerPool`) | Provider double invoking the worker task function in-process, so no Piscina thread is spawned; the worker task modules themselves are covered by unit tests. |
| Filesystem (`CONVERSION_STORAGE_DIR`, `TRANSFORMATION_STORAGE_DIR`, `UPLOADS_DIR`) | Per-file temporary directory created in `beforeAll` and removed in `afterAll`. No path inside the repository is written. |
| Clock / scheduler | Injectable clock double or Jest fake timers. The cleanup cron is invoked directly through its service method; `SchedulerRegistry` is not left running. |

### 4.4 Authentication in Tests
* Authenticated requests are made by signing a real access token for a test user and sending it as the `access_token` cookie — never by disabling `AccessTokenGuard`. Cookie-based auth is part of what is under test.
* RBAC-protected endpoints are exercised with a seeded in-memory role/permission/grant set loaded through `RbacStorageService`, so `RbacGuard` evaluates real grants.
* Every protected endpoint has, at minimum, a `401` case (no cookie / invalid token / wrong `type` claim) and, where RBAC applies, a `403` case.

### 4.5 Test Data
* Sample payloads live in `test/fixtures/` and are the only binary/text assets the suite reads.
* Credentials used in tests are test-only values defined in the harness.

---

## 5. Scenario Checklist by Specification

Each row is the minimum required coverage. `U` = unit, `I` = integration.

### 5.1 Registration and Email Verification (`002-registration`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `UsersService.create` hashes the password; duplicate email rejected. |
| 2 | U | `issueOtp` generates a 6-digit code, stores its bcrypt hash, applies TTL and the resend cooldown. |
| 3 | U | `verifyOtp` accepts a valid code, rejects wrong / expired / already-used codes, increments the attempt counter and rejects past the attempt limit. |
| 4 | U | `@NormalizeEmail()` transform: trimming, case folding, non-string input. |
| 5 | I | `POST /api/auth/registration` → `201`, sets `access_token`/`refresh_token` httpOnly cookies, account created with `isEmailVerified = false`, OTP mail recorded. |
| 6 | I | Registration with an existing email → documented conflict status; with an invalid body → `400` from the global `ValidationPipe`. |
| 7 | I | `POST /api/auth/verify-email` with a valid access token of an **unverified** user → `200`, flag flips; wrong code → documented error; no cookie → `401`. |
| 8 | I | `POST /api/auth/resend-otp` → `200`; a second call inside the cooldown → documented error. |
| 9 | I | No token is returned in a response body (cookie-only delivery). |

### 5.2 RBAC (`003-rbac`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `RbacService.can()` resolves `resource@action`: grant with an explicit action subset, grant with an empty `actions` array (any action), missing grant, unknown resource. |
| 2 | U | `RbacStorageService` builds its maps, serves from cache inside `RBAC_CACHE_TTL_SECONDS`, and reloads after `invalidate()`. |
| 3 | U | `@RbacPermissions()` metadata is read by `RbacGuard`; the guard denies when `request.user` is absent (guard ordering contract). |
| 4 | U | `RbacAuditService.track()` logs both a successful mutation and a rejected (4xx) one with `actorUserId`/`operation`/`entity`/`entityId`. |
| 5 | I | `/api/admin/rbac/roles`, `/permissions`, `/grants`, `/users/:userId/roles`: create/read/update/delete happy paths for an admin. |
| 6 | I | Each admin endpoint returns `401` without a cookie and `403` for a user without the admin permission. |
| 7 | I | A mutation invalidates the cache — a permission granted through the API takes effect on the next protected request without waiting out the TTL. |

### 5.3 Authentication and Authorization (`004-authorization`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `AuthService.login`: unknown email compares against `DUMMY_PASSWORD_HASH` and returns the same error as a wrong password. |
| 2 | U | `registerFailedLogin` increments the counter and locks the account at the configured threshold; `registerSuccessfulLogin` resets it; a locked account is rejected while the lockout window is open and accepted after it elapses (faked clock). |
| 3 | U | Access and refresh tokens carry the `type` claim (`access` / `refresh`); `refreshTokens()` rejects an access token and an expired refresh token. |
| 4 | U | `AccessTokenGuard` reads `request.cookies[ACCESS_TOKEN_COOKIE]` only: an `Authorization: Bearer` header is **not** accepted. Malformed, expired, wrong-`type` and wrong-secret tokens each fail. |
| 5 | U | `AuthCookieService` sets `httpOnly: true`, `sameSite: 'lax'`, `path: '/'` and honours `secure`/`domain` from config; clearing on logout. |
| 6 | U | `@CurrentUser()` extracts the payload the guard attached. |
| 7 | I | `POST /api/auth/login` → `200` + both cookies; wrong password → `401`; repeated failures → lockout response. |
| 8 | I | `POST /api/auth/refresh` with the refresh cookie → new cookies; with the access cookie → `401`. |
| 9 | I | `POST /api/auth/logout` clears both cookies; the previously protected endpoint then returns `401`. |

### 5.4 User Read, Update, Delete, List (`005`–`008`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `UserProfileService`: own-profile access, foreign-profile access denied for a non-admin, allowed for an admin. |
| 2 | U | Update: partial patch semantics, immutable fields ignored/rejected, password change re-hashes. |
| 3 | U | Email change: OTP issued to the **new** address, confirmation swaps the address, a stale or reused confirmation is rejected. |
| 4 | U | Deletion: confirmation flow, deletion of a non-existent user, cascade/cleanup expectations of `007`. |
| 5 | U | Avatar handling in `AvatarStorageService`: accepted type/size, rejected type, path stays inside `UPLOADS_DIR`. |
| 6 | U | List: pagination/filter/sort parameters mapped to the repository query as specified in `008`. |
| 7 | I | `GET /api/users/:userId` — own `200`, foreign `403`, unknown `404`, anonymous `401`. |
| 8 | I | `PATCH /api/users/:userId` — `200` for the owner, `400` on an invalid body, `403` for a foreign profile. |
| 9 | I | `POST /api/users/:userId/email-change` and `/email-change/confirm` — full flow, mail recorded. |
| 10 | I | `DELETE /api/users/:userId` and `/deletion-confirm` — full flow plus the negative cases of `007`. |
| 11 | I | `GET /api/users` — admin `200` with the documented page envelope; non-admin `403`. |

### 5.5 Text File Conversion (`009-text-file-transformation`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | Every handler (`csv`, `json`, `xml`, `yaml`): `sniff` / `parse` / `serialize` round-trip on valid input. |
| 2 | U | `format-detector`: extension and content agree; they disagree; extension unknown but content decisive; content undecidable → documented failure. |
| 3 | U | Error codes are produced for each cause: `INVALID_ENCODING`, `SYNTAX_ERROR`, `LIMIT_EXCEEDED` (depth / node count / YAML aliases), `FORBIDDEN_CONSTRUCT` (e.g. XML external entities), `UNSUPPORTED_FORMAT`. |
| 4 | U | `text-codec` / `decodeTextStream`: multi-byte characters split across chunk boundaries, BOM handling, invalid byte sequences. |
| 5 | U | Streaming path: `readRecords` for CSV and for a top-level JSON array; `createWriter` for all four targets. **Streaming output is byte-identical to `serialize()` over the whole collection for every direction** — this is a hard assertion, including XML whose text nodes contain newlines. |
| 6 | U | `CsvRecordWriter` column union: the `scan()` replay produces the same header as the in-memory path for ragged records. |
| 7 | U | `createRecordBudget()` keeps structure limits document-wide across records, not per record. |
| 8 | U | Worker task: selects the streaming path at/above `CONVERSION_STREAM_THRESHOLD_BYTES` and the in-memory path below it, and for XML/YAML sources and top-level JSON objects at any size. |
| 9 | U | Worker writes `<id>.<ext>.part` and renames only on success; on failure the `.part` file is not promoted. |
| 10 | I | `POST /api/convert` for each supported direction → `200` with the converted payload and the target MIME type. |
| 11 | I | Missing file / missing `targetFormat` / same source and target / unsupported target → `400`. |
| 12 | I | Over the per-format size limit → `413` with `FILE_TOO_LARGE`; undetectable source format → `415`. |
| 13 | I | Worker timeout → `408`. |
| 14 | I | `GET /api/convert/formats` returns the supported directions; both endpoints return `401` without a cookie. |
| 15 | I | A `conversions` row is written for every request that carried a file and a target format: `PROCESSING` → `SUCCESS`, and → `ERROR` with the HTTP `error_code` and `error_reason`; `type` is `file`. |
| 16 | I | Parser error text reaches the client but **no file content appears in the logs**. |

### 5.6 Image Transformation (`010-image-transformation`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `image-format-detector` decides by file signature; a contradicting extension or MIME type, and an unknown extension, both yield the `415` cause. |
| 2 | U | `ImageFormatRegistry.targetsFor()` / `resolveTarget()`: any raster target other than the source is allowed; a same-format target and an SVG target are rejected. |
| 3 | U | `sanitizeSvg()` strips DOCTYPE and entities, `<script>`, `on*` handlers, animation elements, `foreignObject`, and every reference that is not `#…` or `data:image` (including inside `url()`); it rewrites the root size for 72 DPI rendering. A sanitizer bypass attempt is an explicit test case. |
| 4 | U | `raster-input`: header dimensions above `IMAGE_MAX_INPUT_PIXELS` are rejected **before** decoding; `EXCEEDED_MAX_DIMENSIONS` vs `EXCEEDED_MAX_PIXELS` are distinguished. |
| 5 | U | `svg-geometry`: width/height, `viewBox`-only, percentage units, missing dimensions. |
| 6 | U | Image worker task: PNG ↔ JPEG and SVG → PNG/JPEG; `quality`, `width`, `height`, `background` applied; JPEG transparency flattened onto `background`. |
| 7 | U | Every `ImageConversionErrorCode` value is produced by at least one test. |
| 8 | I | `POST /api/images/convert` for each allowed direction → `200` with the correct MIME type. |
| 9 | I | A target of `svg` → `400` with `VECTORIZATION_NOT_SUPPORTED`. |
| 10 | I | Corrupt image → `INVALID_IMAGE`; oversized input → `FILE_TOO_LARGE`; mismatched signature → `415`; timeout → `408`. |
| 11 | I | `GET /api/images/convert/formats`; `401` on both endpoints without a cookie. |
| 12 | I | The `conversions` row carries `type = image` and, on failure, the `ImageConversionErrorCode` in `error_reason` next to the HTTP `error_code`. |

### 5.7 Transformation History (`011-transformation-history`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `toTransformationLog()` mapping, including `source_format = 'unknown'` when the conversion failed before detection and a null `source_file_path` when the input was never stored. |
| 2 | U | `error_code` derivation: `ConversionErrorCode` / `ImageConversionErrorCode` pass through; `TIMEOUT`; HTTP-derived `FILE_TOO_LARGE` and `UNSUPPORTED_FORMAT`. |
| 3 | U | `record()` upserts and **never throws** — a repository failure is swallowed and logged, and the caller's conversion still succeeds. |
| 4 | U | Cursor encode/decode: Base64URL JSON `{ createdAt, id }`, microsecond precision round-trips, malformed/tampered cursor → `400`. |
| 5 | U | The keyset predicate `(created_at, id) < (:createdAt, :id)` and `DESC` ordering are present in the built query. |
| 6 | U | Filters `type`, `sourceFormat`, `targetFormat`, `status`, `createdAtFrom`, `createdAtTo` are applied, combined, and omitted when absent; `limit` bounds are enforced. |
| 7 | I | `GET /api/transformations/history` returns only the caller's rows, newest first, with `{ items, pageInfo: { limit, hasMore, nextCursor } }`. |
| 8 | I | Paging through `nextCursor` yields every row exactly once and ends with `hasMore = false`. |
| 9 | I | `GET /admin/transformations/history` (with and without `userId`) and `GET /admin/users/:userId/transformations/history`: `200` for `transformations.history@admin`, `403` without it, `401` anonymous. |
| 10 | I | A completed conversion (text and image) produces exactly one history row keyed by the conversion id. |

### 5.8 Transformation Storage and Retention (`012-transformation-storage-flow`)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `@ParseBoolean()` on the multipart `save` field: `'true'`, `'false'`, `'1'`, `''`, absent, invalid. |
| 2 | U | `LocalStorageService` `put`/`stat`/`openRead`/`delete`; writes go to a `.part` file renamed only on success; a failed write leaves no promoted file. |
| 3 | U | Storage key format `{YYYY-MM-DD}/{userId}/{itemId}_{targetFormat}.{ext}`, dated from `createdAt` in **UTC**. |
| 4 | U | The backend factory resolves `STORAGE_BACKEND`; an unknown value fails at startup. |
| 5 | U | `TransformationFileService.persist()` sets `is_stored`, `storage_path` and `expires_at = createdAt + DEFAULT_RETENTION_DAYS`; on failure it sets `storage_error_code` `STORAGE_FULL` / `STORAGE_WRITE_FAILED` and leaves `expires_at` unset. |
| 6 | U | Download resolution rule: no `expires_at` → `404`; `expires_at` set but past / purged / missing on disk → `410`. |
| 7 | U | `purgeExpired()` walks `is_stored AND expires_at <= now()` in keyset batches, deletes files, clears `is_stored`/`storage_path`, **keeps `expires_at`**, leaves rows whose delete failed stored for the next run, and reports `purgedFilesCount` / `freedSpaceBytes`. |
| 8 | U | `TransformationStorageCleanupScheduler` registers the cron on `CLEANUP_CRON_SCHEDULE` in UTC. |
| 9 | I | `save=true` does not delay the response: the conversion returns `200` while `persist()` is still pending, and a `persist()` rejection never surfaces to the client. |
| 10 | I | `GET /api/transformations/history/:itemId/download` → `200` with `Content-Disposition: attachment; filename="transformed_<itemId>.<ext>"` and the MIME type from `TRANSFORMATION_MIME_TYPES`; another user's item → `403`; unsaved item → `404`; expired item → `410`; anonymous → `401`. |
| 11 | I | `GET /admin/transformations/history/:itemId/download` and `GET /admin/users/:userId/transformations/history/:itemId/download`: `200` for the admin permission, `404` when the item does not belong to `:userId`, `403` without the permission. |

### 5.9 Cross-Cutting (`001-architecture` and the non-functional requirements)

| # | Layer | Scenario |
| :--- | :--- | :--- |
| 1 | U | `configuration.ts`: `parseIntEnv` rejects a malformed value at startup instead of yielding `NaN`; `requireEnv` throws on a missing or empty `JWT_SECRET`; defaults are applied for optional vars. |
| 2 | U | `HealthService` reports the documented shape. |
| 3 | I | `GET /api/health` → `200` without authentication. |
| 4 | I | Throttling: exceeding the configured rate on an auth endpoint → `429`. |
| 5 | I | Validation: unknown properties are stripped by the whitelist and a type-invalid body → `400` with the documented error shape. |
| 6 | I | Every route is served under the `/api` prefix (a request without it → `404`). |

---

## 6. Definition of Done

The specification is satisfied when all of the following hold:

1. `npm run test:cov` passes on a clean checkout with **no database, no SMTP server and no Docker running**, and reports ≥ 90% for statements, branches, functions and lines over the scope in section 2.2.
2. Every row in section 5 is implemented by at least one test, and every documented error code in `009`/`010`/`011`/`012` is asserted at least once.
3. Every protected endpoint has an explicit `401` test, and every RBAC-gated endpoint an explicit `403` test.
4. The suite is deterministic: repeated runs and a randomized test order produce the same result; no test depends on wall-clock time, real timers, network or files outside its temporary directory.
5. A new feature specification added under `docs/requirements/` extends section 5 with its own scenario table before its implementation is merged.
