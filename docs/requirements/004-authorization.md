# JWT & Cookie-Based Authentication System

## 1. Overview & Architectural Principles
* **Architecture Model:** Stateless JWT-based authentication.
* **Server-Side Token Storage:** **Strictly Forbidden**. The server must not store allowlists/denylists, refresh tokens, `jti` values, or session records in PostgreSQL.
* **Client-Side Token Storage:** Tokens must be stored and transmitted exclusively via secure `Set-Cookie` HTTP headers.
* **Session Verification:** The server relies on cryptographic signature verification and expiration claims, alongside account status checks in the database.

---

## 2. JWT Tokens & Cookie Configuration

### 2.1 Token Lifespans (TTL)
* **Access Token:** **15 minutes**.
* **Refresh Token:** **30 days**.

### 2.2 Cookie Security Attributes
Both tokens must be delivered exclusively via HTTP cookies with the following security flags:
* `HttpOnly: true` — Prevents client-side JavaScript access (mitigates XSS).
* `Secure: true` — Ensures cookies are transmitted strictly over HTTPS.
* `SameSite: Lax` — Protects against CSRF attacks.
* `Max-Age` / `Expires` — Cookie lifetime must be strictly synchronized with the corresponding JWT TTL.

---

## 3. Functional Scenarios & API Specifications

### 3.1 Login / Authentication (`POST /api/auth/login`)
* **Request Payload:**
  * `email`: `string` (valid email format).
  * `password`: `string` (user password).
* **Processing Logic:**
  1. Look up user by `email`.
  2. Verify password hash (using `bcrypt`).
  3. Generate JWT pair (`access_token` with 15-min TTL, `refresh_token` with 30-day TTL) with claim `sub` = `userId`.
  4. Issue HTTP `Set-Cookie` headers for `access_token` and `refresh_token`.
* **Responses:**
  * `200 OK` — Authentication successful; cookies attached in headers.
  * `400 Bad Request` — Invalid input payload format.
  * `401 Unauthorized` — Invalid email or password (generic error message to prevent user enumeration attacks).
  * `403 Forbidden` — Account disabled or locked.

### 3.2 Protected Resource Access (Session Verification)
* **Input:** `access_token` cookie.
* **Verification Logic:**
  1. Extract `access_token` from request cookies.
  2. Validate cryptographic signature and standard claims (`exp`, `nbf`, `iat`, `iss`, `aud`).
  3. Extract `sub` (`userId`).
  4. Verify user existence and active status in the database.
  5. Attach user context (`userId`, `roles`) to the request object (`request.user`).
* **Responses:**
  * `200 OK` — Access granted.
  * `401 Unauthorized` — Missing token, signature verification failed, or token expired (`exp` elapsed).

### 3.3 Token Refresh (`POST /api/auth/refresh`)
* **Input:** `refresh_token` cookie.
* **Scenario:** `access_token` has expired, but `refresh_token` remains valid.
* **Processing Logic:**
  1. Extract `refresh_token` from request cookies.
  2. Validate signature and expiration (`exp`) without querying server-side session stores.
  3. **Token Rotation:** On every successful refresh request, issue a **brand-new token pair** (new `access_token` and new `refresh_token`).
  4. Send updated `Set-Cookie` headers for both tokens in the response.
* **Responses:**
  * `200 OK` — New token pair set in cookies.
  * `401 Unauthorized` — `refresh_token` missing, invalid, or expired.

### 3.4 Logout & Invalid Refresh Handling (`POST /api/auth/logout`)
* **Scenario 1 (Explicit Logout):** User initiates logout.
* **Scenario 2 (Invalid/Expired Refresh):** Call to `/refresh` returns `401 Unauthorized`.
* **Clearing Logic (given server-side state is forbidden):**
  1. Server sends `Set-Cookie` headers setting `access_token` and `refresh_token` to expire in the past (`Max-Age=0` / `Expires=Thu, 01 Jan 1970 00:00:00 GMT`).
  2. Client-side application clears local session state and redirects user to `/login`.

---

## 4. Logging & Audit Requirements
* **Permitted Logging:**
  * Failed authentication attempts (invalid credentials, locked account) including IP and User-Agent metadata.
  * JWT validation errors (expired token, signature failure) with diagnostic reasons excluding sensitive data.
* **Strictly Prohibited Logging:**
  * Plaintext passwords.
  * Full JWT token strings (`access` and `refresh`).
  * Secret signing keys.

---

## 5. Implementation Checklist for Claude
1. Implement Guard / Middleware to inspect and validate the `access_token` cookie.
2. Configure response `Set-Cookie` headers with `HttpOnly`, `Secure`, and `SameSite` flags.
3. Ensure token rotation occurs on every `/refresh` request (both cookies updated).
4. Implement automatic cookie invalidation (`Max-Age=0`) on refresh token error or `/logout`.
5. Verify zero database tables or Redis schemas are created for session or refresh token storage.
