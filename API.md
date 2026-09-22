# API Reference

Base URL: `http://localhost:4000` (or `NEXT_PUBLIC_API_URL`). All request/
response bodies are JSON unless noted. All endpoints except `/api/health`
and `/api/auth/login`/`/logout` require the `access_token` cookie (see
[SECURITY.md](SECURITY.md)); `requirePermission` gates below list the exact
permission key each route checks.

Common error shape: `{ "error": string, "details"?: object }`. `details` is
present on `400` responses from Zod validation failures.

## Health

### `GET /api/health`
No auth. Returns `{ "status": "ok" }`.

## Auth

### `POST /api/auth/login`
Rate-limited (10 requests / 15 min per IP).

Body: `{ "email": string, "password": string }`

- `200` → `{ id, email, name, role }`, sets `access_token`/`refresh_token`
  httpOnly cookies. Never returns a token in the body.
- `400` invalid body. `401` wrong email/password.

### `POST /api/auth/logout`
No auth required (so an already-expired session can still clear cookies).
Clears both cookies. `200` → `{ "success": true }`.

### `GET /api/auth/me`
Requires auth. `200` → `{ id, email, name, role, permissions: string[] }`.
`401` if not authenticated.

## Servers

All routes require auth.

### `GET /api/servers`
Permission: `server:view`.
Query: `search?`, `os?` (`LINUX`\|`WINDOWS`\|`OTHER`), `environment?`
(`PRODUCTION`\|`UAT`\|`DEVELOPMENT`\|`TEST`), `status?`
(`ACTIVE`\|`INACTIVE`\|`DECOMMISSIONED`), `page?` (default 1), `pageSize?`
(default 20, max 100), `sortBy?` (`hostname`\|`createdAt`\|`environment`\|`os`,
default `createdAt`), `sortOrder?` (`asc`\|`desc`, default `desc`).
`200` → `{ data: Server[], total, page, pageSize }`.

### `POST /api/servers`
Permission: `server:create`.
Body: `{ hostname, ipAddress, os, environment, application, owner, location?, username, sshPort?, description? }`.
`201` → created server. `400` invalid. `409` duplicate hostname.

### `GET /api/servers/:id`
Permission: `server:view`. `200` → server (includes `assignedKey`,
`createdBy`). `404` if missing.

### `PUT /api/servers/:id`
Permission: `server:edit`. Body: any subset of the create fields plus
`status?`. `200` → updated server. `404`. `409` duplicate hostname.

### `DELETE /api/servers/:id`
Permission: `server:delete`. `204`. `404`.

## SSH Keys

All routes require auth. **Private key content never appears in any JSON
response** — metadata queries exclude `storageRef`/`iv`/`authTag` by
construction, and the only way to get key bytes is the download endpoint.

### `GET /api/keys`
Permission: `key:view`. Query: `search?` (matches key name).
`200` → array of key metadata: `{ id, name, keyType, description, owner, lastAccessedAt, createdAt, updatedAt, assignedServer }`.

### `POST /api/keys`
Permission: `key:upload`. `multipart/form-data`: fields `name`, `keyType`
(`rsa`\|`ed25519`\|`ecdsa`\|`dsa`), `description?`, and file field `file`
(≤64KB, must start with `-----BEGIN`). `201` → key metadata. `400` invalid
metadata, missing file, or file doesn't look like a PEM private key. `409`
duplicate key name.

### `GET /api/keys/:id`
Permission: `key:view`. `200` → key metadata. `404`.

### `GET /api/keys/:id/download`
Permission: `key:download`. **Viewer role never has this permission.**
`200` → binary body, `Content-Type: application/octet-stream`,
`Content-Disposition: attachment; filename="<key name>"` — never JSON.
Records a `KEY_DOWNLOADED` audit event and bumps `lastAccessedAt` before
streaming. `404` if the key doesn't exist.

### `DELETE /api/keys/:id`
Permission: `key:delete`. `204`. `404`. Also deletes the encrypted blob
from storage.

### `POST /api/keys/:id/assign`
Permission: `key:assign` — **granted to Operator only, not Admin** (see
[ARCHITECTURE.md](ARCHITECTURE.md#rbac) for why). Body:
`{ "serverId": string }`. `200` → updated server (`assignedKeyId` set).
`404` key not found. `400` invalid body.

## Dynamic Inventory

All routes require auth.

### `GET /api/inventory/entities`
Permission: `inventory:view`. `200` → array of entities, each with its
`fields` (ordered by `displayOrder`) and `_count.records`.

### `POST /api/inventory/entities`
Permission: `inventory:create` (**Admin only**). Body:
`{ name, description?, fields: [{ fieldName, fieldType, required?, options?, displayOrder? }] }`
— `fieldType` is one of `TEXT`\|`NUMBER`\|`BOOLEAN`\|`DATE`\|`SELECT`\|`TEXTAREA`;
`options` (string array) is required and non-empty when `fieldType` is
`SELECT`. `201` → entity with created fields. `400` invalid. `409`
duplicate entity name.

**v1 limitation:** fields cannot be changed after entity creation — there
are no field-mutation endpoints. Delete and recreate the entity if the
schema needs to change.

### `GET /api/inventory/entities/:id`
Permission: `inventory:view`. `200` → entity with fields. `404`.

### `PUT /api/inventory/entities/:id`
Permission: `inventory:manage`. Body: `{ name?, description? }` only
(fields are immutable). `200`. `404`. `409` duplicate name.

### `DELETE /api/inventory/entities/:id`
Permission: `inventory:manage`. `204`. `404`. Cascades to the entity's
fields and records.

### `GET /api/inventory/entities/:id/records`
Permission: `inventory:view`. Query: `page?`, `pageSize?` (max 100).
`200` → `{ data: InventoryRecord[], total, page, pageSize }`.

### `POST /api/inventory/entities/:id/records`
Permission: `inventory:manage`. Body: `{ "data": { [fieldName]: value } }`
— validated at request time against the entity's actual field definitions
(required fields present, `NUMBER`/`BOOLEAN` coerced, `SELECT` restricted
to that field's `options`). `201` → record. `400` invalid data (includes
Zod `issues` detailing which field failed). `404` entity not found.

### `PUT /api/inventory/records/:id`
Permission: `inventory:manage`. Body: `{ "data": {...} }`, validated the
same way. `200`. `400`. `404`.

### `DELETE /api/inventory/records/:id`
Permission: `inventory:manage`. `204`. `404`.

## Users

All routes require `user:manage` (**Admin only**).

### `GET /api/users`
`200` → array of `{ id, email, name, authProvider, role: { id, name }, createdAt, updatedAt }`. Never includes `passwordHash`.

### `POST /api/users`
Body: `{ email, name, password (min 8 chars), roleId }`. `201` → created
user. `400` invalid. `409` duplicate email.

### `GET /api/users/:id`
`200` → user. `404`.

### `PUT /api/users/:id`
Body: `{ name?, roleId?, password? }`. Changing `roleId` also fires a
`PERMISSION_CHANGED` audit event in addition to `USER_UPDATED`. `200`.
`404`. `409` duplicate email.

### `DELETE /api/users/:id`
`204`. `404`.

## Roles

### `GET /api/roles`
Permission: `role:manage` (**Admin only**). Read-only — no role
create/edit/delete endpoints exist; the three roles are fixed at seed time.
`200` → array of `{ id, name, description, permissions: string[] }`.

## Audit Logs

### `GET /api/audit-logs`
Permission: `audit:view` (all three roles). Query: `action?`,
`resourceType?`, `userId?`, `page?`, `pageSize?` (max 100).
`200` → `{ data: AuditLogEntry[], total, page, pageSize }`, each entry
including the acting `user` (`id`, `name`, `email`) and `metadata` (never
contains secrets or key content).

Actions actually logged: `LOGIN`, `LOGOUT`, `SERVER_CREATED`,
`SERVER_UPDATED`, `SERVER_DELETED`, `KEY_UPLOADED`, `KEY_DOWNLOADED`,
`KEY_DELETED`, `KEY_ASSIGNED`, `USER_CREATED`, `USER_UPDATED`,
`PERMISSION_CHANGED`, `INVENTORY_CREATED`, `INVENTORY_UPDATED`,
`INVENTORY_RECORD_CREATED`, `INVENTORY_RECORD_DELETED`. Entity deletion and
inventory record updates are **not** audited — they weren't in the original
request's audited-action list.

## Dashboard

### `GET /api/dashboard`
Requires auth only (no specific permission — every stat is derived from
data all three roles can already view individually).
`200` → `{ totalServers, linuxServers, windowsServers, productionServers, uatServers, developmentServers, totalKeys, recentActivity: AuditLogEntry[] }`
(`recentActivity` is the 10 most recent audit log entries).
