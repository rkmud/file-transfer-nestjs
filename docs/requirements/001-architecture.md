# Architecture

## Technologies

- **Runtime / language**: Node.js, TypeScript 5
- **Framework**: NestJS 11 (`@nestjs/core`, `@nestjs/platform-express`)
- **Database**: PostgreSQL 16, accessed via TypeORM 0.3 (`@nestjs/typeorm`, `pg`)
- **Auth**: JWT (`@nestjs/jwt`) for access/refresh tokens, `bcrypt` for password and OTP hashing
- **Config**: `@nestjs/config`, single typed config factory
- **Rate limiting**: `@nestjs/throttler`
- **Mail**: `@nestjs-modules/mailer` + `nodemailer` + Handlebars templates, sent via Mailpit in development
- **API docs**: `@nestjs/swagger` (served at `/docs`)
- **Validation / serialization**: `class-validator`, `class-transformer`
- **Testing**: Jest, `ts-jest`
- **Lint / format**: ESLint 9 (flat config, `typescript-eslint`), Prettier 3
- **Local infra**: Docker Compose (`postgres:16-alpine`, `axllent/mailpit`)

## Project structure

```
src/
├── common/                  # Shared decorators/utilities used across modules
│   └── decorators/
├── core/                    # App wiring
│   ├── app/                 # Root module (app.module.ts)
│   ├── config/              # Typed config factory (configuration.ts)
│   ├── health/               # Health check endpoint (controller/service/dto)
│   ├── swagger/              # Swagger bootstrap + constants
│   └── templates/             # Handlebars templates shared by mail (e.g. verification-code.hbs)
├── database/                 # TypeORM setup
│   ├── data-source.ts         # CLI data source (used by migration:* scripts)
│   ├── database.module.ts     # App-side TypeOrmModule.forRootAsync
│   ├── typeorm.config.ts      # Shared buildDataSourceOptions
│   └── migrations/
├── mail/                     # MailerModule wrapper (templates live in core/templates)
├── modules/                   # Feature modules
│   ├── users/                  # User + Otp entities/service (OTP is issued/verified as part of UsersService), no internal deps
│   ├── auth/                   # Registration, login, JWT issuance, guards
│   └── rbac/                   # Role/permission/grant system, admin endpoints
└── main.ts                   # Bootstrap, global prefix `/api`
```

### Module dependency direction

`users` → no internal dependencies
`auth` → imports `users`, `mail`
`rbac` → imports `auth` (for `AccessTokenGuard`) and `users`

> **Note:** The standalone `otp` module was folded into `users` — the `Otp` entity now lives at `src/modules/users/otp.entity.ts` and its issue/verify logic is exposed as `UsersService.issueOtp`/`UsersService.verifyOtp`. No migration was needed for this change: the `otp` table, its columns, and its FK to `users` are unchanged — only the TypeScript module layout moved.
>
> **Note:** The `verification-code.hbs` Handlebars template moved from `src/mail/templates/` to `src/core/templates/`. `mail.module.ts`'s `HandlebarsAdapter` now points its `dir` at `join(__dirname, '../core/templates')`; `nest-cli.json`'s `**/*.hbs` asset glob copies it to `dist/core/templates/` unchanged.
