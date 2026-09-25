# Specification: User Profile Update & Email Change Flow (006-user-update-flow.md)

## 1. Overview & Objective
This document defines the requirements, endpoint contracts, authorization rules, and business logic for updating user profiles and executing email changes (`PATCH /users/{userId}`, `POST /users/{userId}/email-change`, `POST /users/{userId}/email-change/confirm`).

The system enforces Role-Based Access Control (RBAC), JWT authentication (via HTTP-only cookies), and a **strict security policy**:
* **Self (`user`):** Can update editable profile fields directly. Direct email modification and security field overrides are strictly prohibited and trigger a `403 Forbidden` error. Email changes must proceed via a multi-step OTP verification flow.
* **Admin (`admin`):** Can directly update any profile field for any user, including `email`, `isEmailVerified`, `failedLoginAttempts`, and `lockedUntil`, bypassing the OTP requirement.
* **Roles are out of scope for this endpoint.** A role is not a column on `users` — it is a `(user_id, role_id)` row in the RBAC table `user_roles`. `PATCH /users/{userId}` never reads or writes it, for any actor. Role assignment lives entirely under `/admin/rbac/users/{userId}/roles` (`GET` / `POST { roleId }` / `DELETE /{roleId}`), which works with role IDs and supports multiple roles per user. Every user gets the default `user` role at registration.

---

## 2. API Endpoints Overview

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `PATCH` | `/users/{userId}` | Self, Admin | Updates user profile fields. Supports `multipart/form-data` for avatar uploads. |
| `POST` | `/users/{userId}/email-change` | Self Only | Initiates the email change process by sending an OTP to the new email. |
| `POST` | `/users/{userId}/email-change/confirm` | Self Only | Verifies the OTP code and updates the user's email address upon success. |

---

## 3. Detailed Endpoint Contracts

### 3.1 Update User Profile: `PATCH /users/{userId}`

#### Request Specifications
* **Method:** `PATCH`
* **Path:** `/users/{userId}`
* **Content-Type:** `multipart/form-data` (or `application/json` when updating text fields without a photo file).

#### Field Permissions & Access Rules
* **Editable Fields for Self (`user`):**
  * `firstName` (`string | null`, optional)
  * `lastName` (`string | null`, optional)
  * `phone` (`string | null`, optional)
  * `bio` (`string | null`, optional)
  * `locale` (`string`, optional)
  * `photo` (`file` / `multipart`, optional)
* **Forbidden Fields for Self (`user`):**
  * If a `Self` user includes `email`, `isEmailVerified`, `failedLoginAttempts`, `lockedUntil`, or `password` in the payload, the server MUST reject the request with `403 Forbidden`.
* **Unknown Fields (any actor):**
  * `role` is not part of this payload. It is stripped by the global `ValidationPipe` (`whitelist: true`) like any other unknown field: the request succeeds and the role is left untouched — no `403`, no role change.
* **Editable Fields for Admin (`admin`):**
  * Admins can modify **all fields of the profile** directly, including `email`, `isEmailVerified`, `failedLoginAttempts`, `lockedUntil`, and standard profile attributes. Changing a user's role is done via the RBAC endpoints, not here.

#### Avatar Upload Specifications (`photo`)
* **Supported Formats:** `image/jpeg` (`.jpg`, `.jpeg`), `image/png` (`.png`), `image/webp` (`.webp`), `image/gif` (`.gif`).
* **Max File Size:** 5 MB.
* **Storage Location:** Saved locally on the server filesystem using `fs.writeFile`.
* **Database Representation:** Only the relative file path is persisted in the database `photo` column (e.g., `/static/avatars/550e8400-e29b-41d4-a716-446655440000.png`).
* **Replacement Strategy:** Updating the photo replaces the existing relative path in the database.

---

### 3.2 Initiate Email Change: `POST /users/{userId}/email-change`

#### Request Specifications
* **Method:** `POST`
* **Path:** `/users/{userId}/email-change`
* **Access Control:** Self Only (`req.user.id === params.userId`). Admin requests or third-party attempts return `403 Forbidden`.
* **Payload (`application/json`):**
  ```json
  {
    "newEmail": "new.email@example.com"
  }
  ```

#### Business Logic & Validation Steps
1. **Validate Email Format:** Ensure `newEmail` is a valid email string.
2. **Uniqueness Check:** Verify that `newEmail` is not already registered to another user in the database. If occupied, return `409 Conflict`.
3. **Generate Challenge & OTP:**
   * Create an OTP challenge record associated with the user and `newEmail`.
   * **OTP TTL:** 10 minutes.
   * **Resend Cooldown:** 60 seconds between resend requests.
4. **Send Email Notification:** Dispatch an email containing the 6-digit OTP code to `newEmail` using the standardized email change template.

#### Success Response (200 OK)
```json
{
  "requiresConfirmation": true,
  "challengeId": "c7b8a9d0-1234-5678-9abc-def012345678",
  "expiresAt": "2026-09-24T03:20:00.000Z"
}
```

---

### 3.3 Confirm Email Change: `POST /users/{userId}/email-change/confirm`

#### Request Specifications
* **Method:** `POST`
* **Path:** `/users/{userId}/email-change/confirm`
* **Access Control:** Self Only (`req.user.id === params.userId`).
* **Payload (`application/json`):**
  ```json
  {
    "challengeId": "c7b8a9d0-1234-5678-9abc-def012345678",
    "code": "849201"
  }
  ```

#### Business Logic & Validation Steps
1. **Validate Challenge:** Check if `challengeId` exists, is active, and belongs to `userId`.
2. **Check TTL & Attempt Limits:**
   * Ensure the challenge has not expired (within 10 minutes).
   * Ensure attempt count has not exceeded 5 failed attempts.
3. **Verify OTP:** Compare provided `code` with stored challenge OTP.
4. **Update Email:** Upon verification:
   * Update `email` column in the database with `newEmail`.
   * Mark `isEmailVerified` as `true` (if re-verification policy applies).
   * Invalidate/delete the challenge.

#### Success Response (200 OK)
```json
{
  "message": "Email updated successfully",
  "email": "new.email@example.com"
}
```

---

## 4. Email Notification Template & OTP Parameters

### 4.1 Shared OTP Configuration
* **Code Format:** 6-digit numeric string (e.g., `849201`).
* **Time-to-Live (TTL):** 10 minutes.
* **Max Invalid Attempts:** 5 attempts per challenge.
* **Resend Cooldown:** 60 seconds.

### 4.2 Email Template Guidelines (Email Change)
* **Subject:** Confirm your new email address
* **Body Elements:**
  * Greeting with current user name or email.
  * Explicit notification that an email change request was initiated.
  * Prominent display of the 6-digit OTP code.
  * Expiration warning (code valid for 10 minutes).
  * Security disclaimer: "If you did not request this change, please contact support immediately."

---

## 5. Error Status Codes & Response Matrix

| Status Code | Error Scenario | Description / Cause |
| :--- | :--- | :--- |
| `400 Bad Request` | Invalid Input / Format | Malformed JSON, invalid email syntax, incorrect OTP code length. |
| `401 Unauthorized` | Missing / Invalid Auth | Invalid, missing, or expired JWT access cookie. |
| `403 Forbidden` | Access Denied / IDOR | Attempting to update another user's profile, or `Self` including restricted fields (`email`, `isEmailVerified`, `password`, etc.) in `PATCH`. |
| `404 Not Found` | Entity Missing | `userId` or `challengeId` does not exist. |
| `409 Conflict` | Email Occupied | `newEmail` is already registered to another active user. |
| `413 Payload Too Large` | File Size Exceeded | Uploaded avatar image exceeds the 5 MB limit. |
| `415 Unsupported Media Type` | Invalid File Format | Uploaded avatar image is not JPG, PNG, WebP, or GIF. |
| `429 Too Many Requests` | Rate Limit Exceeded | OTP resend cooldown violated or API call rate limit reached. |
