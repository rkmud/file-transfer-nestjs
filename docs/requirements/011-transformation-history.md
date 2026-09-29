# Technical Specification: Transformation History Module (011-transformation-history-flow)

## 1. Overview and Architectural Principles

### 1.1 Purpose
The Transformation History Module provides a centralized, secure tracking system for auditing all file and image transformation operations across the platform. It offers REST APIs for both standard users (to view their own transformation history) and administrators (to audit platform-wide user activity or specific user histories).

### 1.2 Key Architectural Principles
* **Centralized Audit Trail:** Every text file conversion (`009`) and image transformation (`010`) logs a detailed metadata record upon completion or failure.
* **Cursor-Based Pagination:** Efficient retrieval of historical logs using stable cursor pointers (`createdAt` timestamp + record `id` encoded in Base64) to prevent page drift and handle large datasets smoothly.
* **Role-Based Access Control (RBAC):** Strict separation between user-level access (`GET /api/transformations/history`) and admin-level access (`GET /admin/transformations/history` and `GET /admin/users/{userId}/transformations/history`) enforcing granular permissions (`transformations.history.admin`).
* **Database Optimization:** Mandated database indexes on user, timestamp, transformation type, and status fields to guarantee low-latency filtering.

---

## 2. REST API Specification

### 2.1 Authorization & Permissions
* **User Endpoints:** Require valid JWT access token via HTTP-only cookie.
* **Admin Endpoints:** Require valid JWT access token and explicit administrative permission (`transformations.history.admin`). Unauthorized requests return `401 Unauthorized`; permission violations return `403 Forbidden`.

---

### 2.2 Endpoints Overview

| Endpoint | Method | Role | Description |
| :--- | :--- | :--- | :--- |
| `/api/transformations/history` | `GET` | User / Admin | Retrieve current authenticated user's transformation history |
| `/admin/transformations/history` | `GET` | Admin | Retrieve global system-wide transformation history across all users |
| `/admin/users/{userId}/transformations/history` | `GET` | Admin | Retrieve transformation history for a specific user |

---

### 2.3 User Transformation History Endpoint

**Endpoint:** `GET /api/transformations/history`  
**Authentication:** Required (JWT)

#### Query Parameters

| Parameter | Type | Required | Default | Description / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `cursor` | String | No | null | Base64-encoded pagination cursor (`createdAt` timestamp + record `id`). |
| `limit` | Integer | No | `20` | Page size limit. Min: `1`, Max: `100`. |
| `type` | String | No | null | Filter by transformation domain: `file` (text/data conversion) or `image`. |
| `sourceFormat` | String | No | null | Filter by input format (`csv`, `json`, `xml`, `yaml`, `png`, `jpeg`, `svg`). |
| `targetFormat` | String | No | null | Filter by output format (`csv`, `json`, `xml`, `yaml`, `png`, `jpeg`, `svg`). |
| `status` | String | No | null | Filter by operation status: `success` or `error`. |
| `createdAtFrom`| String | No | null | ISO 8601 start timestamp filter (e.g., `2026-01-01T00:00:00Z`). |
| `createdAtTo`  | String | No | null | ISO 8601 end timestamp filter (e.g., `2026-12-31T23:59:59Z`). |

---

### 2.4 Admin Global Transformation History Endpoint

**Endpoint:** `GET /admin/transformations/history`  
**Authentication:** Required (JWT + `transformations.history.admin` role)

#### Query Parameters
Accepts all query parameters from Section 2.3, plus:

| Parameter | Type | Required | Default | Description / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `userId` | String | No | null | Filter transformations by specific User ID. |

---

### 2.5 Admin User-Specific Transformation History Endpoint

**Endpoint:** `GET /admin/users/{userId}/transformations/history`  
**Authentication:** Required (JWT + `transformations.history.admin` role)

#### Query Parameters
Accepts all query parameters from Section 2.3. Path parameter `userId` explicitly targets the given user.

---

### 2.6 Response Schema (History Endpoints)

#### Response `200 OK`
```json
{
  "items": [
    {
      "id": "trans_9f8a7b6c5d4e",
      "userId": "usr_123456789",
      "type": "image",
      "sourceFormat": "svg",
      "targetFormat": "png",
      "status": "success",
      "fileSize": 1048576,
      "durationMs": 342,
      "errorCode": null,
      "createdAt": "2026-09-28T04:15:30.123Z"
    },
    {
      "id": "trans_1a2b3c4d5e6f",
      "userId": "usr_123456789",
      "type": "file",
      "sourceFormat": "xml",
      "targetFormat": "json",
      "status": "error",
      "fileSize": 5242880,
      "durationMs": 115,
      "errorCode": "MALFORMED_XML_PAYLOAD",
      "createdAt": "2026-09-28T03:10:12.000Z"
    }
  ],
  "pageInfo": {
    "limit": 20,
    "hasMore": true,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTI4VDAzOjEwOjEyLjAwMFoiLCJpZCI6InRyYW5zXzFhMmIzYzRkNWU2ZiJ9"
  }
}
```

---

## 3. Cursor-Based Pagination Logic

### 3.1 Cursor Encoding & Decoding
* **Format:** JSON object `{"createdAt": "ISO_TIMESTAMP", "id": "RECORD_ID"}` stringified and encoded in `Base64URL`.
* **Database Query Strategy:**
  ```sql
  WHERE (created_at < :cursorCreatedAt)
     OR (created_at = :cursorCreatedAt AND id < :cursorId)
  ORDER BY created_at DESC, id DESC
  LIMIT :limit + 1
  ```
* **Page Info Calculation:** Fetch `limit + 1` rows. If `limit + 1` rows are returned, `hasMore = true`, drop the last row, and construct `nextCursor` from the `limit`-th item's `createdAt` and `id`.

---

## 4. Auditing, Logging, and Data Model

### 4.1 Database Schema Requirements

Table name: `transformation_logs`

| Field Name | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | String / UUID | Primary Key | Unique transformation record identifier |
| `user_id` | String / UUID | Indexed, Not Null | Owner User ID |
| `type` | Enum (`file`, `image`) | Indexed, Not Null | Domain classification |
| `source_format` | String | Indexed, Not Null | Original extension (`csv`, `png`, etc.) |
| `target_format` | String | Indexed, Not Null | Target extension |
| `status` | Enum (`success`, `error`) | Indexed, Not Null | Operation outcome |
| `error_code` | String | Nullable | Machine-readable error code |
| `file_size` | BigInt | Not Null | Source file size in bytes |
| `duration_ms` | Integer | Not Null | Transformation execution duration in milliseconds |
| `source_file_path` | String | Not Null | Relative path in Local Storage for original file |
| `target_file_path` | String | Nullable | Relative path in Local Storage for output file |
| `created_at` | Timestamp TZ | Indexed, Not Null | Record creation timestamp |

### 4.2 Composite Indexes
To guarantee high performance across filtering combinations, the database MUST include:
* `idx_trans_user_created` ON `transformation_logs (user_id, created_at DESC, id DESC)`
* `idx_trans_type_status` ON `transformation_logs (type, status, created_at DESC)`
* `idx_trans_created` ON `transformation_logs (created_at DESC, id DESC)`

---

## 5. Error Handling and Status Codes

| HTTP Status | Trigger Condition |
| :--- | :--- |
| `200 OK` | Query successfully executed and results returned. |
| `400 Bad Request` | Invalid query parameters (e.g. `limit > 100`, malformed ISO date, invalid cursor format). |
| `401 Unauthorized` | Missing, invalid, or expired JWT access token. |
| `403 Forbidden` | Standard user requesting admin endpoint (`/admin/...`) or attempting to view another user's history without permissions. |
| `404 Not Found` | Requested `userId` not found in database. |
| `500 Internal Server Error` | Database execution failure or unhandled system error. |
