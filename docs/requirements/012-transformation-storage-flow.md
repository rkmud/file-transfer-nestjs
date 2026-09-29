# Technical Specification: Transformation Storage & Retention Module (012-transformation-storage-flow)

## 1. Overview and Architectural Principles

### 1.1 Purpose
The Transformation Storage & Retention Module extends the existing text file conversion (`009`) and image transformation (`010`) services by providing optional persistent storage for transformed outputs. Users can explicitly request that transformed files be stored in application storage for subsequent retrieval during a defined retention period.

### 1.2 Key Architectural Principles
* **Pluggable Storage Abstraction:** Storage operations are decoupled behind a unified `StorageService` interface. The primary and default implementation is **Local Storage**, with architecture designed to support secondary cloud providers (e.g., AWS S3, Google Cloud Storage, Firebase) without modifying domain logic.
* **Non-Blocking Asynchronous Persistence:** Writing output files to persistent storage runs asynchronously in worker background tasks. Storage I/O must never delay, block, or degrade the primary HTTP response stream returning converted binary payload to the client.
* **Time-To-Live (TTL) & Retention Governance:** All persisted files are assigned an explicit expiration timestamp (`expiresAt`). A background cleanup process regularly purges expired files from storage to optimize disk utilization.
* **Secure Access Control:** File retrieval is strictly bound to user ownership and Role-Based Access Control (RBAC), ensuring standard users can only download their own saved transformations while administrators can download saved outputs globally.

---

## 2. API Contract Modifications & Downloads Specification

### 2.1 Transformation Endpoint Extensions

The conversion request contracts for both `POST /api/convert` (009) and `POST /api/images/convert` (010) are updated to accept an additional form field.

#### Added Request Form Parameter

| Parameter | Type | Required | Default | Description / Constraints |
| :--- | :--- | :--- | :--- | :--- |
| `save` | Boolean | No | `false` | When `true`, instructs the system to persist the transformed output file to Local Storage and register a download reference in the transformation history log. |

#### Processing Workflow with `save` Parameter
1. **Request Execution:** Execute standard file conversion or image rasterization as defined in specifications `009` and `010`.
2. **Immediate Client Streaming:** Stream the converted binary payload back to the client with `200 OK`.
3. **Conditional Storage Handler (`save = true`):**
   * Asynchronously pass output buffer to `StorageService`.
   * Save output file to Local Storage under a unique system path.
   * Calculate `expiresAt = createdAt + RETENTION_PERIOD`.
   * Update the transformation audit record in the database with `fileId`, `storagePath`, `expiresAt`, and `isStored = true`.
4. **Handling Storage Failures:** If an asynchronous storage error occurs (e.g., storage disk full, write error), the primary `200 OK` response already sent to the client remains unaffected. The database record registers `isStored = false` and logs a storage error code.

---

### 2.2 User File Download Endpoint

**Endpoint:** `GET /api/transformations/history/{itemId}/download`  
**Authentication:** Required (JWT)

#### Request Rules
* `{itemId}` corresponds to the unique history record ID.
* The system verifies that the authenticated user is the owner of the transformation record (`userId == currentUserId`).

#### Response Specifications
* **`200 OK`**: Binary stream of the saved transformed file.
  * **Headers:**
    * `Content-Type`: MIME type of target format (`text/csv`, `application/json`, `image/png`, `image/jpeg`, etc.)
    * `Content-Disposition`: `attachment; filename="transformed_<itemId>.<ext>"`
* **`401 Unauthorized`**: Missing or invalid JWT access cookie.
* **`403 Forbidden`**: Requesting user does not own the requested history record.
* **`404 Not Found`**: History record does not exist or `save=false` was specified for this transformation.
* **`410 Gone`**: The file was previously saved, but its retention period (`expiresAt`) has passed and the file has been purged from Local Storage.

---

### 2.3 Admin User-Specific File Download Endpoint

**Endpoint:** `GET /admin/users/{userId}/transformations/history/{itemId}/download`  
**Authentication:** Required (JWT + `transformations.history.admin` role)

#### Request Rules
* Path parameter `{userId}` specifies the target user.
* System verifies that `{itemId}` belongs to `{userId}`.

---

### 2.4 Admin Global File Download Endpoint

**Endpoint:** `GET /admin/transformations/history/{itemId}/download`  
**Authentication:** Required (JWT + `transformations.history.admin` role)

#### Request Rules
* Direct lookup of stored file by `{itemId}` across all users in the system without requiring `{userId}` path prefix.

---

## 3. Storage Architecture & Retention Governance

### 3.1 Storage Directory Structure (Local Storage)

Files are organized in Local Storage using isolated directory structures to prevent filesystem bottlenecking:

```
/var/app/storage/transformations/
├── {YYYY-MM-DD}/
│   └── {userId}/
│       └── {itemId}_{targetFormat}.[ext]
```

### 3.2 Automated Background Cleanup (Cron Purge)

* **Execution Schedule:** Daily cron job executed at `00:00:00 UTC`.
* **Purge Criteria:**
  ```sql
  SELECT id, storage_path 
  FROM transformation_logs 
  WHERE is_stored = true 
    AND expires_at <= NOW();
  ```
* **Execution Logic:**
  1. Delete physical file from Local Storage if present.
  2. Update database record: `is_stored = false`, `storage_path = null`.
  3. Log purge completion metrics (`purgedFilesCount`, `freedSpaceBytes`).

---

## 4. Database Schema Extensions

The `transformation_logs` database table (from specification `011`) is extended with storage tracking columns:

| Field Name | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `is_stored` | Boolean | Indexed, Default: `false` | Indicates whether output file is currently stored in Local Storage |
| `storage_path` | String | Nullable | Relative Local Storage path for output file |
| `expires_at` | Timestamp TZ | Indexed, Nullable | Expiration timestamp when file becomes eligible for automated cleanup |

---

## 5. Default System Configuration

* **`DEFAULT_RETENTION_DAYS`**: `90 days`
* **`CLEANUP_CRON_SCHEDULE`**: `0 0 * * *` (Daily at Midnight UTC)
* **`STORAGE_BACKEND`**: `LOCAL_STORAGE`
