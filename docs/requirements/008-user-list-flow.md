# Specification: Admin User Directory List Flow (008-user-list-flow.md)

## 1. Overview & Objective
This specification defines the functional requirements, query parameters, data response contract, authorization rules, and execution logic for retrieving the paginated list of all users (`GET /users`).
The system operates under a **default-deny security posture**, enforcing Role-Based Access Control (RBAC) where access is restricted **strictly to Admin users**, while rejecting requests from non-admin roles with a `403 Forbidden` response.

---

## 2. Authorization Rules & Role Access Matrix

* **Authentication:** Required via Access JWT in HTTP-only Cookie.
* **Role Permissions:**
  * **`Admin` Role:** **Allowed** (`200 OK`). Full access to retrieve and filter the user directory.
  * **`User` / Non-Admin Roles (`Self` or Third-Party):** **Denied** (`403 Forbidden`).
  * **Unauthenticated Requests:** **Denied** (`401 Unauthorized`).

---

## 3. API Contract: `GET /users`

### 3.1 Endpoint Details
* **Method:** `GET`
* **Path:** `/users`
* **Authentication:** Required (JWT in HTTP-only Cookie)

### 3.2 Query Parameters

| Parameter | Type | Required | Default | Description / Constraints |
| :--- | :--- | :---: | :---: | :--- |
| `cursor` | `string \| null` | Optional | `null` | Pagination cursor token for deterministic dataset traversal. |
| `limit` | `number` | Optional | `20` | Number of items per page. Allowed range: `1` to `100`. |
| `q` | `string` | Optional | `null` | Case-insensitive search string matching `email`, `firstName`, `lastName`, or `id`. |
| `status` | `string` | Optional | `null` | Filter by user status: `"active" \| "blocked" \| "deleted"`. |
| `sort` | `string` | Optional | `"created_at"` | Field to sort by: `"created_at" \| "last_login" \| "email"`. |
| `order` | `string` | Optional | `"desc"` | Sort direction: `"asc" \| "desc"`. |

### 3.3 Status Filter Evaluation Logic
* **`blocked`**: Evaluates to true if `lockedUntil` timestamp is set and is in the future (`lockedUntil > NOW()`).
* **`active`**: Evaluates to true if the account is not locked (`lockedUntil IS NULL` or `lockedUntil <= NOW()`).
* **`deleted`**: Evaluates to true if soft-deletion flag or anonymized state is present.

---

## 4. Response Contract & Field Visibility

### 4.1 Response Structure
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "photo": "/static/avatars/550e8400.png",
      "bio": "Pioneer of computer programming.",
      "locale": "en",
      "phone": "+1234567890",
      "isEmailVerified": true,
      "createdAt": "2026-09-24T10:15:00.000Z",
      "lastLoginAt": "2026-09-24T12:40:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCIsImNyZWF0ZWRBdCI6IjIwMjYtMDktMjRUMTA6MTU6MDAuMDAwWiJ9"
}
```

### 4.2 Item Fields Matrix (`UserListItem`)

| Field Name | Type | Visibility | Notes |
| :--- | :--- | :---: | :--- |
| `id` | `string (uuid)` | ✅ Included | Unique user identifier |
| `email` | `string` | ✅ Included | Full unmasked email address (visible to Admin) |
| `firstName` | `string \| null` | ✅ Included | Given name |
| `lastName` | `string \| null` | ✅ Included | Family name |
| `photo` | `string \| null` | ✅ Included | Relative path to local photo file (e.g. `/static/avatars/{id}.png`) |
| `bio` | `string \| null` | ✅ Included | Short biography |
| `locale` | `string` | ✅ Included | Preferred user locale (default: `'en'`) |
| `phone` | `string \| null` | ✅ Included | Phone number |
| `isEmailVerified` | `boolean` | ✅ Included | Email OTP verification status |
| `createdAt` | `string (ISO)` | ✅ Included | Account creation timestamp |
| `lastLoginAt` | `string (ISO) \| null` | ✅ Included | Last successful login timestamp |
| `password` | - | ❌ **Strictly Omitted** | Password hash is excluded from all queries |
| `tokens / secrets` | - | ❌ **Strictly Omitted** | Security tokens, 2FA secrets, internal flags are forbidden |

---

## 5. Error Status Codes & Response Handling

* **`200 OK`**: Successfully retrieved paginated user list.
* **`400 Bad Request`**: Invalid query parameters (e.g., `limit` exceeds 100, malformed `cursor`, or invalid `sort`/`order` value).
* **`401 Unauthorized`**: Missing, invalid, or expired Access JWT cookie.
* **`403 Forbidden`**: User does not possess the `admin` role.
* **`429 Too Many Requests`**: Rate limit exceeded for directory listing requests.

---

## 6. Security, Performance & Infrastructure Requirements

### 6.1 Performance & Indexing
* Search parameters (`q`) must utilize indexed database fields (`email`, `first_name`, `last_name`, `id`) to prevent unindexed full-table scans.
* Cursor-based pagination (`cursor`) MUST be used instead of offset-based pagination (`OFFSET / LIMIT`) to maintain stable performance on large user tables.

### 6.2 Rate Limiting
* Strict rate limits must be applied to `GET /users` to protect the database against enumeration and heavy analytical queries.
