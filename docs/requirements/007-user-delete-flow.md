# Specification: User Account Deletion Flow (007-user-delete-flow-v2.md)

## 1. Overview & Objective
This specification defines the requirements, API contract, authorization matrix, and data cleanup sequence for user account deletion (`DELETE /users/{userId}`).

The endpoint operates under a **default-deny security posture** using JWT authentication (via HTTP-only cookies) and Role-Based Access Control (RBAC).

---

## 2. API Contract & Endpoint Specification

### 2.1 Endpoints
All routes are mounted under the global `/api` prefix and require an Access JWT in an HTTP-only cookie.

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `DELETE` | `/users/{userId}` | Self: starts deletion and emails a code. Admin: deletes the target user immediately. |
| `POST` | `/users/{userId}/deletion-confirm` | Self: verifies the code and deletes the account. |

Self-deletion is always a two-step flow: `DELETE` never removes the caller's own account, it only issues a challenge. There is no separate `deletion-request` endpoint — `DELETE` *is* the request step — and `DELETE` does not accept an OTP payload; confirmation goes exclusively through `/deletion-confirm`.

### 2.2 Authorization Matrix (IDOR Protection)

| Requester Role | Condition | Permission | Behavior |
| :--- | :--- | :---: | :--- |
| **Self** | `req.user.id === requestedUserId` | ✅ **Allowed** | Can delete own profile (requires email OTP confirmation). |
| **Admin** | holds the `users@delete` RBAC permission | ✅ **Allowed** | Can delete ANY other user profile directly without OTP confirmation. |
| **Other / Third Party** | `req.user.id !== requestedUserId` AND no `users@delete` | ❌ **Denied** | Returns **`403 Forbidden`** (IDOR Protection). |

The self check is evaluated first, so an admin deleting their *own* account follows the OTP flow like any other user.

---

## 3. Execution Flows

### 3.1 Flow A: Admin Deletion (Direct Execution)
* **Request:** `DELETE /users/{userId}` by a holder of `users@delete`, where `userId` is another user.
* **Payload (Optional):**
  ```json
  {
    "reason": "Administrative account removal"
  }
  ```
* **Processing:**
  1. Validates the JWT and the `users@delete` permission.
  2. Executes the account deletion sequence (Section 4).
  3. Revokes all active sessions for the target user.
  4. Records `reason` in the audit log.
  5. Returns `200 OK`:
     ```json
     {
       "message": "User account deleted",
       "userId": "550e8400-e29b-41d4-a716-446655440000"
     }
     ```

### 3.2 Flow B: Self-Deletion (Email OTP Confirmation)

To prevent accidental or malicious self-deletion, when `Self` (`req.user.id === requestedUserId`) calls `DELETE /users/{userId}`:

#### Step 1: Initiate Deletion Request
* **Request:** `DELETE /users/{userId}`, no payload required.
* **Server Action:**
  1. Validates the JWT and confirms `req.user.id === requestedUserId`.
  2. Generates a 6-digit OTP deletion code (`OTP_TTL_SECONDS`, default 10 minutes) with purpose `account_deletion`.
  3. Sends the code to the user's registered email address. A failed send returns `503` and no challenge.
  4. Returns `200 OK`:
     ```json
     {
       "requiresConfirmation": true,
       "challengeId": "550e8400-e29b-41d4-a716-446655440000",
       "expiresAt": "2026-09-24T03:20:00.000Z",
       "message": "Deletion OTP code sent to your email address"
     }
     ```

  Repeating the request re-issues the code, subject to `OTP_RESEND_COOLDOWN_SECONDS` (default 60s); a request inside the cooldown returns `429`. Only one `account_deletion` challenge exists per user at a time.

#### Step 2: Confirm Deletion
* **Request:** `POST /users/{userId}/deletion-confirm`
* **Payload:**
  ```json
  {
    "challengeId": "550e8400-e29b-41d4-a716-446655440000",
    "code": "123456"
  }
  ```
* **Server Action:**
  1. Validates `challengeId`, the OTP code and its TTL (up to `OTP_MAX_ATTEMPTS` failed attempts, default 5).
  2. Executes the account deletion sequence (Section 4).
  3. Invalidates active user cookies and session state.
  4. Returns `200 OK`:
     ```json
     {
       "message": "User account deleted",
       "userId": "550e8400-e29b-41d4-a716-446655440000"
     }
     ```

---

## 4. Deletion Execution Sequence & Data Cleanup

When deletion is executed, the server synchronously performs the following steps:

1. **Database Records Cleanup (Hard Delete):**
   * Removes the record from the `users` table (`DELETE FROM users WHERE id = :userId`).
   * Cascades cleanup for associated pending OTP codes, email-change requests and reset tokens (`otp.user_id` is `ON DELETE CASCADE`), and for the user's RBAC role assignments.
2. **Session & Token Revocation:**
   * Access and refresh tokens are stateless and are not persisted, so removing the user row is what revokes them: `AccessTokenGuard` and `refreshTokens()` both reject tokens whose user no longer exists.
   * Further login attempts are impossible because the account is gone.
   * The in-memory RBAC cache is invalidated so the deleted user's grants are dropped immediately.
3. **Local Storage Cleanup (Photo File):**
   * If `photo` contains a relative path under the configured uploads prefix (e.g. `/static/avatars/{file}.png`), the server deletes the physical avatar file from the local filesystem via `fs.unlink`. A missing file is not an error.
4. **Cookie Invalidation:**
   * For `Self` deletion (`/deletion-confirm`), sets expired HTTP-only cookie headers to clear client authentication cookies.
5. **Audit Log:**
   * Logs `actorUserId`, `targetUserId`, the mode (`self` / `admin`) and, for admin deletions, the supplied `reason`.

Deletion is guarded by a per-user in-flight lock; a concurrent deletion of the same `userId` returns `409 Conflict`.

---

## 5. Error Status Codes

* **`200 OK`**: Deletion challenge issued, or deletion successfully completed.
* **`400 Bad Request`**: Malformed payload, invalid or expired OTP code, `userId` is not a valid uuid.
* **`401 Unauthorized`**: Missing, invalid, or expired JWT cookie.
* **`403 Forbidden`**: Attempting to delete another user's profile without `users@delete` (IDOR Protection).
* **`404 Not Found`**: Target `userId` or the referenced challenge does not exist.
* **`409 Conflict`**: Deletion process is already active for this `userId`.
* **`429 Too Many Requests`**: Resend cooldown, too many invalid OTP attempts, or rate limit exceeded.
* **`503 Service Unavailable`**: The deletion code could not be emailed.
