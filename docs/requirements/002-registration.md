# Registration

Source: `docs/TASK1.md` (§1, "Регистрация"), structured against the implementation in `src/modules/auth` and `src/modules/users`.

## 1. Purpose

Create a user account from an email + password pair.

## 2. Actors

- **Guest** — an unauthenticated user. The only actor that can call `POST /api/auth/registration`.

## 3. User story

**Registration with email confirmation:** the user submits `email` + `password`; the account is created immediately but stays unverified until the user confirms it with a one-time code (OTP) sent to their email.

There is no "confirmation disabled" mode — registration always goes through the OTP flow described below.

## 4. Flow

1. Accept `email` and `password`.
2. Validate the input (see [Validation](#5-validation)).
3. Reject if a user with that email already exists.
4. Create the user in an unverified state (`isEmailVerified: false`).
5. Issue an access/refresh token pair for the new (still unverified) user immediately, so the client can call the confirmation endpoints without a separate login step.
6. Issue an OTP for the `registration` purpose and email it to the user.
7. Respond with the user, the token pair, and a flag indicating verification is required.

Confirmation and resend then happen out-of-band, authenticated with the access token issued at step 5:

8. `POST /api/auth/verify-email` — validate the submitted OTP against the pending one for that user; on success mark the user verified, delete the OTP record from the database, and issue a fresh token pair.
9. `POST /api/auth/resend-otp` — subject to the resend cooldown, delete the user's existing OTP record and insert a new one.

## 5. Validation

| Field | Rule |
|---|---|
| `email` | valid email format, normalized to lowercase, must not already belong to a registered user |
| `password` | non-empty string, minimum 8 characters, must contain at least one letter, one digit, and one special character |
| `otp` (verify-email) | exactly 6 digits |

Implemented in `CreateUserDto` (`src/modules/users/dto/create-user.dto.ts`) and `VerifyEmailDto` (`src/modules/auth/dto/verify-email.dto.ts`).

## 6. OTP parameters

| Parameter | Default | Env var |
|---|---|---|
| Code length | 6 digits | — (fixed, `OTP_LENGTH` constant) |
| TTL | 600s (10 min) | `OTP_TTL_SECONDS` |
| Max verification attempts | 5 | `OTP_MAX_ATTEMPTS` |
| Resend cooldown | 60s | `OTP_RESEND_COOLDOWN_SECONDS` |

Configured via `OtpConfig` in `src/core/config/configuration.ts`. OTP issuing/verification logic lives on `UsersService.issueOtp` / `UsersService.verifyOtp` (`src/modules/users/users.service.ts`); the code is hashed with bcrypt before being stored on the `Otp` entity (`src/modules/users/otp.entity.ts`) and never persisted in plaintext.

An `Otp` row is never soft-consumed or left behind: `issueOtp` deletes any existing pending row for that user/purpose before inserting the new one (so a resend always replaces, rather than updates in place), and `verifyOtp` deletes the row outright on a successful match instead of stamping `consumedAt`. A user therefore has at most one `Otp` row per purpose at any time.

## 7. Error scenarios

| Scenario | Response |
|---|---|
| Invalid email format | `400 Bad Request` |
| Password does not meet policy | `400 Bad Request` |
| Email already registered | `400 Bad Request` ("User already exists") |
| OTP missing / never requested | `400 Bad Request` |
| OTP expired | `400 Bad Request` |
| OTP does not match | `400 Bad Request`, includes `attemptsLeft` |
| OTP verification attempts exceeded | `429 Too Many Requests` |
| Resend requested before cooldown elapses | `429 Too Many Requests`, includes `retryAfterSeconds` |
| Resend / verify-email called with an already-verified user | `400 Bad Request` |
| Mail delivery failure while sending the OTP | `503 Service Unavailable` |
| Missing/invalid access token on verify-email or resend-otp | `401 Unauthorized` |

> Note: the current implementation does **not** return a neutral response when the email is already registered — it returns a distinct `400` ("User already exists"). If the security requirement to hide account existence at registration time is adopted later, this endpoint needs to be revisited (unlike `/auth/login`, which already uses a dummy-hash comparison to keep timing/response neutral for unknown emails).

## 8. API surface

Implemented in `src/modules/auth/auth.controller.ts`, all endpoints mounted under the global `/api` prefix:

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/auth/registration` | none (throttled) | Creates the user, issues tokens, sends the OTP |
| `POST /api/auth/verify-email` | access token (unverified user allowed) | Confirms the email with the OTP, issues fresh tokens |
| `POST /api/auth/resend-otp` | access token (unverified user allowed) | Sends a new OTP |

`verify-email` and `resend-otp` are guarded only by `AccessTokenGuard`, not by `isEmailVerified` — they operate on the current (possibly unverified) user resolved via `CurrentUser()`.

## 9. Out of scope

- Password reset (the `OtpPurpose.PasswordReset` enum value exists on the `Otp` entity for future use but has no issuing/consuming endpoint yet).
- Login, refresh, and account lockout are covered by the existing `auth` flow (`CLAUDE.md` → "Auth flow") and are not part of this requirement.
