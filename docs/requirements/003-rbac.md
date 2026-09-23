# 003-rbac.md Requirements Specification

## 1. Overview & Objectives
* **Purpose**: Provide centralized Role-Based Access Control (RBAC) based on dynamic roles, permissions, and grant assignments stored in the database.
* **Dynamic Configuration**: The system must apply configuration changes dynamically without requiring an application restart.
* **Execution Context**: Authorization checks take place after successful request authentication via JWT. RBAC logic remains independent of any single application framework.

---

## 2. System Entities & Data Models

### 2.1 Roles
* **Description**: Represents user access groups.
* **Data Schema**:
  * `id`: `string` — Unique identifier.
  * `name`: `string` — Unique role name.
  * `description`: `string` (optional) — Summary of the role.

### 2.2 Permissions
* **Description**: Represents target system resources and their supported operations.
* **Data Schema**:
  * `id`: `string` — Unique identifier.
  * `name`: `string` — Unique permission name (e.g., `permission1`).
  * `actions`: `string[]` — Array of valid actions for the permission (e.g., `['create', 'update', 'delete']`).

### 2.3 Grants (Assignments)
* **Description**: Mappings connecting roles to permissions and specific actions.
* **Data Schema**:
  * `id`: `string` — Unique grant identifier.
  * `roleId`: `string` — Associated role ID.
  * `permissionId`: `string` — Associated permission ID.
  * `actions`: `string[]` (optional) — Explicit actions allowed.
* **Action Logic**:
  * If `actions` is omitted or empty, all actions associated with the permission are granted.
  * If `actions` is populated, access is strictly limited to the listed actions.

---

## 3. System Actors
* **Admin**: Authorized administrator capable of managing roles, permissions, and grants.
* **User**: Authenticated entity holding one or more roles subjected to access evaluation.

---

## 4. Access Check Contract & Logic

### 4.1 Internal Call Payload
Internal verification requires the following payload:
* `userId`: `string` — User ID extracted from JWT token.
* `roles`: `string[]` — List of assigned user roles.
* `permission`: `string` — Target permission identifier.
* `action`: `string` — Requested action.

### 4.2 Pre-Validation Checks
Before rule evaluation, the module must verify:
1. User authentication state.
2. User roles exist within active configuration.
3. Target permission exists within active configuration.
4. Requested action is defined as a valid action for the permission.

### 4.3 Evaluation Workflow
1. Retrieve the user's assigned roles.
2. Identify all grants matching the user's roles from loaded configuration.
3. Inspect matching permissions and allowed actions.
4. Grant access if a matching grant specifies no explicit actions (all allowed) or includes the requested action.
5. **Response**: Allow request execution to proceed if authorized; otherwise, return `403 Forbidden`.

---

## 5. Caching & Dynamic Updates
* **Initial Load**: Configuration (roles, permissions, grants) loads from the database on startup.
* **Cache Management**: An optional caching layer may be utilized for fast access checks.
* **Invalidation Flow**: When an Admin updates rules in the DB, a cache reset triggers a configuration reload into memory without restarting the server.

---

## 6. Administrative REST API Specification

### 6.1 Role Management (`Admin` only)
* `GET /admin/rbac/roles` — Fetch all roles.
* `POST /admin/rbac/roles` — Create a new role.
* `PUT /admin/rbac/roles/{roleId}` — Update an existing role.
* `DELETE /admin/rbac/roles/{roleId}` — Delete a role.

### 6.2 Permission Management (`Admin` only)
* `GET /admin/rbac/permissions` — Fetch all permissions.
* `POST /admin/rbac/permissions` — Create a new permission.
* `PUT /admin/rbac/permissions/{permissionId}` — Update an existing permission.
* `DELETE /admin/rbac/permissions/{permissionId}` — Delete a permission.

### 6.3 Grant Management (`Admin` only)
* `GET /admin/rbac/grants` — Fetch all grants.
* `POST /admin/rbac/grants` — Create a new grant.
* `PUT /admin/rbac/grants/{grantId}` — Update an existing grant.
* `DELETE /admin/rbac/grants/{grantId}` — Delete a grant.

---

## 7. Validation Constraints & Error Handling

### 7.1 Validation Constraints
* All management operations are restricted to **Admin** users.
* Role names and permission names must be strictly unique.
* Referenced `roleId` and `permissionId` must exist prior to grant creation.
* Duplicate grants (`roleId` + `permissionId`) are strictly prohibited.
* Entities with active grant dependencies cannot be deleted.

### 7.2 Standard HTTP Responses
* **`200 OK` / `201 Created`**: Successful execution.
* **`400 Bad Request`**: Invalid payload or action format.
* **`403 Forbidden`**: Unauthorized caller or access denied.
* **`404 Not Found`**: Non-existent role, permission, or grant.
* **`409 Conflict`**: Duplicate role name, permission name, or grant mapping.
