# Specification: User Profile Access & Management Flow (005-user-flow.md)

## 1. Overview & Objective
This document defines the functional requirements, text-based database structure description, API contracts, and business logic for retrieving user profile data (`GET /users/{userId}`).
The system operates under a **default-deny** security posture, using JWT authentication (via HTTP-only cookie) and Role-Based Access Control (RBAC).

---

## 2. Database Structure Description (`users` Table)

The database contains a `users` table. Below is a text description of all table fields, their types, and purposes:

### Core & Authentication Fields
* **`id`** (`uuid`, Primary Key) — Unique identifier for the user (auto-generated).
* **`email`** (`varchar`, Unique, Not Null) — User's email address, used as a login identifier.
* **`password`** (`varchar`, Not Null) — **User's password, stored strictly as a salted hash**. This field is marked as hidden from default queries (`select: false`) and **is never returned in API responses under any circumstances**.
* **`role`** (`enum`: `'user'` | `'admin'`, Default: `'user'`) — User role in the system. Newly registered users are assigned the `user` role by default.

### Profile Fields (Populated Post-Registration)
* **`first_name` / `firstName`** (`varchar`, Nullable) — User's given name.
* **`last_name` / `lastName`** (`varchar`, Nullable) — User's surname.
* **`photo`** (`varchar`, Nullable) — Path to the profile avatar. Stores a **relative path** to the file on the local server filesystem (e.g., `/static/avatars/550e8400.png`).
* **`phone`** (`varchar`, Nullable) — User's phone number (optional field; SMS/OTP verification is not implemented).
* **`bio`** (`varchar`, Nullable) — Short bio or description.
* **`locale`** (`varchar`, Default: `'en'`) — User's preferred language / locale.

### Security & Status Fields
* **`is_email_verified` / `isEmailVerified`** (`boolean`, Default: `false`) — Flag indicating whether the email was verified via the Email OTP flow.
* **`failed_login_attempts` / `failedLoginAttempts`** (`int`, Default: `0`) — Counter of failed login attempts (**visible only to Administrators**).
* **`locked_until` / `lockedUntil`** (`timestamptz`, Nullable) — Account lock expiration timestamp (**visible only to Administrators**).
* **`last_login_at` / `lastLoginAt`** (`timestamptz`, Nullable) — Timestamp of the last successful login.

### System Timestamps
* **`created_at` / `createdAt`** (`timestamptz`, Default: `NOW()`) — Account creation timestamp.
* **`updated_at` / `updatedAt`** (`timestamptz`, Default: `NOW()`) — Last record update timestamp.

---

## 3. API Contract: `GET /users/{userId}`

### 3.1 Endpoint Details
* **Method:** `GET`
* **Path:** `/users/{userId}`
* **Authentication:** Required via Access JWT in HTTP-only Cookie.

### 3.2 Authorization Matrix (IDOR Protection)
1. **Self Access:** `req.user.id === requestedUserId` -> **Allowed** (Returns standard profile).
2. **Admin Access:** `req.user.role === 'admin'` -> **Allowed** (Returns standard profile + security fields).
3. **Other Users / Third Party:** `req.user.id !== requestedUserId` AND `req.user.role !== 'admin'` -> **Denied (403 Forbidden)**.

---

## 4. Field Visibility & Default-Deny Rules

### 4.1 Response Fields Matrix

| Field Name | Type | Self (`user`) | Admin (`admin`) | Description / Constraints |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `string (uuid)` | ✅ | ✅ | User unique identifier |
| `email` | `string` | ✅ | ✅ | Email address |
| `photo` | `string \| null` | ✅ | ✅ | Relative path to photo |
| `firstName` | `string \| null` | ✅ | ✅ | First name |
| `lastName` | `string \| null` | ✅ | ✅ | Last name |
| `phone` | `string \| null` | ✅ | ✅ | Phone number |
| `bio` | `string \| null` | ✅ | ✅ | Biography |
| `locale` | `string` | ✅ | ✅ | Locale |
| `isEmailVerified` | `boolean` | ✅ | ✅ | Email verification status |
| `createdAt` | `string (ISO)` | ✅ | ✅ | Account creation timestamp |
| `lastLoginAt` | `string (ISO) \| null` | ✅ | ✅ | Last login timestamp |
| `updatedAt` | `string (ISO)` | ✅ | ✅ | Last update timestamp |
| `failedLoginAttempts` | `number` | ❌ | ✅ | **Admin Only** |
| `lockedUntil` | `string (ISO) \| null` | ❌ | ✅ | **Admin Only** |
| `password` | - | ❌ | ❌ | **Strictly excluded from responses** |

---

## 5. Response Examples

### 5.1 Response for `Self` Role (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "photo": "/static/avatars/550e8400.png",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "phone": null,
  "bio": null,
  "locale": "en",
  "isEmailVerified": true,
  "createdAt": "2026-09-24T10:15:00.000Z",
  "lastLoginAt": "2026-09-24T12:40:00.000Z",
  "updatedAt": "2026-09-24T12:41:00.000Z"
}
```

### 5.2 Response for `Admin` Role (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "photo": "/static/avatars/550e8400.png",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "phone": null,
  "bio": null,
  "locale": "en",
  "isEmailVerified": true,
  "createdAt": "2026-09-24T10:15:00.000Z",
  "lastLoginAt": "2026-09-24T12:40:00.000Z",
  "updatedAt": "2026-09-24T12:41:00.000Z",
  "failedLoginAttempts": 0,
  "lockedUntil": null
}
```

### 5.3 Error Status Codes
* **`401 Unauthorized`**: Missing, invalid, or expired JWT cookie.
* **`403 Forbidden`**: Attempt to view another user's profile without administrator privileges (IDOR protection).
* **`404 Not Found`**: Target `userId` does not exist in the database.
* **`429 Too Many Requests`**: Rate limit exceeded.

---

## 6. Infrastructure, Storage & Security Requirements

### 6.1 Photo Storage
* Avatar photos are stored locally on the server filesystem using `fs.writeFile`.
* The database stores **only relative paths** (e.g., `/static/avatars/{userId}.png`).

### 6.2 Registration Flow
* Initial user creation requires minimal data: `email` and `password` (stored as a hash).
* All other profile fields (`firstName`, `lastName`, `phone`, `bio`, `photo`) default to `null` initially and are populated later by the user.

### 6.3 Rate Limiting
* Rate limiting is applied to the `GET /users/{userId}` endpoint to protect against brute-force enumeration and automated scanning.
```