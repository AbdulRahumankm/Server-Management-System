# Architecture

## System Overview

```
Browser
  │
  ▼
Next.js (App Router, TypeScript, Tailwind)
  │  HTTPS / REST, credentials: 'include'
  ▼
Express API (TypeScript)
  │  Prisma Client
  ▼
PostgreSQL
```

The frontend never touches the database directly — every read and write
goes through the REST API. The backend is the sole source of truth for
authentication and authorization; the frontend's route guards and
permission-gated UI are convenience only.

## Backend Layering

```
Routes  →  Controllers  →  Services  →  Prisma
```

- **Routes** (`backend/src/routes/`) wire an HTTP verb+path to
  `requireAuth` → `requirePermission(key)` → a controller handler. No
  business logic lives here.
- **Controllers** (`backend/src/controllers/`) parse/validate the request
  (Zod), call one or more service functions, map results and typed errors to
  HTTP status codes, and fire audit log writes where applicable.
- **Services** (`backend/src/services/`) hold business logic and are the
  only layer that talks to `prisma`. Every service exports typed error
  classes (e.g. `ServerNotFoundError`, `DuplicateHostnameError`) that
  controllers catch and translate to specific status codes.
- **Prisma** (`backend/prisma/schema.prisma`) is the single schema for
  every model — `User`, `Role`, `Permission`, `RolePermission`, `Server`,
  `SSHKey`, `InventoryEntity`, `InventoryField`, `InventoryRecord`,
  `AuditLog`. UUID primary keys throughout.

Module inventory (each pair of directories mirrors one feature):

| Feature | Schema/Service | Routes | Frontend pages |
|---|---|---|---|
| Auth | `authService`, `tokenService`, `passwordService` | `/api/auth/*` | `/login` |
| Servers | `serverService` | `/api/servers/*` | `/servers`, `/servers/new`, `/servers/[id]`, `/servers/[id]/edit` |
| SSH Keys | `keyService` + `storage/` | `/api/keys/*` | `/keys`, `/keys/upload` |
| Dynamic Inventory | `inventoryService` | `/api/inventory/*` | `/inventory`, `/inventory/[id]` |
| Users & Roles | `userService` | `/api/users/*`, `/api/roles` | `/users`, `/roles` |
| Audit | `auditService` | `/api/audit-logs` | `/audit-logs` |
| Dashboard | `dashboardService` | `/api/dashboard` | `/dashboard` |

## Authentication

Local email/password auth, Argon2 password hashing
(`@node-rs/argon2` — chosen over the native `argon2` package because this
network's TLS-inspecting proxy breaks `argon2`'s prebuilt-binary and
node-gyp fallback downloads; `@node-rs/argon2` ships prebuilt binaries as
ordinary npm registry packages).

On login, the backend issues two JWTs as httpOnly/secure(prod)/sameSite=lax
cookies — a short-lived access token (~15 min) and a longer-lived refresh
token (~7 days). `requireAuth` middleware verifies the access token; if
expired, it transparently verifies the refresh token and re-issues a new
access token in the same response, so the frontend never has to implement
its own refresh flow. `User.authProvider`/`providerId` exist so a future
OIDC/SSO integration can populate the same table without a schema change.

## RBAC

`Role` ←→ `Permission` via `RolePermission` (many-to-many), seeded with
three roles (`backend/prisma/seed.ts`). Every mutating and sensitive-read
route is wrapped in `requirePermission('resource:action')`, which loads the
authenticated user's role's permission keys and returns 403 if the required
key is missing.

The actual seeded permission set evolved during implementation beyond the
original request's literal per-role bullet list, in two ways worth knowing:

1. **View permissions** (`server:view`, `key:view`, `inventory:view`) were
   added to Admin and Operator, who originally only had the mutating
   permissions for those resources. Without them, Admin/Operator would get
   403 simply *listing* servers/keys/inventory — the original request's
   role lists didn't separate "view" from "manage" as distinct permission
   keys, but the actual RBAC middleware design requires that separation.
2. **`key:assign`** is intentionally *not* granted to Admin — the original
   request's Admin permission list stops at "Upload key, Download key,
   Delete key" and doesn't include "Assign key", while Operator's list
   explicitly has it. This is followed literally rather than assumed to be
   an oversight.

See each phase's plan under `docs/superpowers/plans/` for the full reasoning
trail on every permission decision.

## SSH Key Encryption

`backend/src/storage/StorageProvider.ts` defines the storage contract:

```ts
interface StorageProvider {
  put(id: string, plaintext: Buffer): Promise<{ storageRef: string; iv: string; authTag: string }>;
  get(storageRef: string, iv: string, authTag: string): Promise<Buffer>;
  delete(storageRef: string): Promise<void>;
}
```

`LocalFilesystemStorageProvider` is the v1 implementation: AES-256-GCM
(authenticated encryption) via Node's built-in `crypto`, key from
`ENCRYPTION_KEY`. `put()` encrypts before ever writing a byte to disk;
`get()` reads ciphertext and decrypts in memory. Swapping to S3/MinIO later
means writing one new class against the same interface — no service-layer
changes.

`SSHKey` rows store only `storageRef`/`iv`/`authTag` (references, never
content). Every Prisma query for key metadata uses an explicit `select`
that excludes those three fields, so there's no code path where key
material — encrypted or not — can leak into a JSON response. The only route
that returns file bytes is `GET /api/keys/:id/download`, which streams
`application/octet-stream`.

## Dynamic Inventory

`InventoryEntity`/`InventoryField`/`InventoryRecord` — no real Postgres
table is created per user-defined entity. `InventoryRecord.data` is JSONB.

The interesting mechanism is `buildRecordDataSchema()` in
`inventoryService.ts`: given an entity's `InventoryField` rows, it builds a
Zod object schema *at request time* (one branch per `FieldType`: NUMBER →
coerced number, BOOLEAN → coerced boolean, SELECT → enum of that field's
`options`, everything else → string), and every record write is validated
against it. The frontend's `DynamicRecordForm` mirrors the same
`FieldType` → input-type mapping to render the right input for each field,
so no per-entity frontend code is needed either.

**v1 limitation, deliberate:** fields cannot be added or changed after an
entity is created. The original request's REST API section lists no
field-mutation endpoints, and diffing/migrating existing JSONB records
against a changed field set is complexity this version doesn't need. If a
schema needs to change, delete and recreate the entity.

## Audit Logging

`auditService.logAudit()` is the single write path — controllers call it
directly (no middleware), because *when* to log and what metadata to
include differs per action. The one ordering rule that matters: SSH key
download logs the `KEY_DOWNLOADED` event *before* decrypting, matching the
required sequence (auth → permission → exists → authorized → **audit** →
decrypt → stream). `AuditLog.metadata` never contains secrets or key
content — verified by an explicit test assertion in
`backend/tests/audit.test.ts`.

## Frontend

Next.js App Router, one route segment per page under `frontend/app/`.
Server state (everything that comes from the API) is managed by TanStack
Query, not component state — every page's data-fetching goes through
`apiFetch()` (`frontend/lib/apiClient.ts`), a thin `fetch` wrapper that
adds `credentials: 'include'` and skips forcing a JSON `Content-Type` when
the body is `FormData` (needed for the key upload multipart form).

`useCurrentUser()` (`frontend/lib/useCurrentUser.ts`) fetches `/api/auth/me`
and exposes the current user's `permissions: string[]`, which pages use to
conditionally render actions (e.g. the Download/Delete buttons on the keys
list only render if the user's permissions include `key:download`/
`key:delete`). This is UX only — the backend independently re-checks every
permission on every request.

`proxy.ts` (Next.js's post-16 rename of `middleware.ts`) redirects
unauthenticated requests to protected paths toward `/login` by checking for
the access-token cookie's presence — again, UX only.

Shared UI primitives live under `frontend/components/ui/` (Button, Input,
Label, Table, Dialog, AlertDialog) — hand-authored, Tailwind-styled,
Radix-based where real accessibility behavior (focus trap, escape-to-close)
is worth not re-implementing (`Dialog`, `AlertDialog`).

## Implementation History

This system was built phase-by-phase, each phase specced, planned, and
verified before merging. The full design spec and every phase's detailed
implementation plan (including the reasoning behind every scope decision
and gap fix mentioned above) live under `docs/superpowers/specs/` and
`docs/superpowers/plans/`.
