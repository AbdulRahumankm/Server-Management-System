# Internal Server Inventory & Key Management Platform — Design

Date: 2026-09-22
Status: Approved for planning

## 1. Purpose

An internal web application for managing server inventory, server/application
metadata, SSH keys, users, roles, and audit logs. Single company-internal
tool; not multi-tenant, not public-facing.

## 2. Technology Stack

- **Frontend**: Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui,
  React Hook Form, Zod, TanStack Query.
- **Backend**: Node.js, Express.js, TypeScript, REST, Zod validation.
- **Database**: PostgreSQL via Prisma ORM.
- **Infra**: Docker, Docker Compose, optional Nginx reverse proxy, `.env`
  configuration.

No Python/FastAPI anywhere in this project.

## 3. Repository Layout

Single repo, two independently runnable apps — no npm workspaces, to keep
frontend and backend genuinely decoupled:

```
ServerManagementSystem/
├── frontend/                # Next.js app
├── backend/                 # Express app
│   ├── src/
│   │   ├── routes/          # HTTP routing only
│   │   ├── controllers/     # request/response mapping
│   │   ├── services/        # business logic
│   │   ├── middleware/      # auth, permission, error handling, rate limit
│   │   ├── storage/         # StorageProvider abstraction (SSH key blobs)
│   │   └── lib/             # prisma client, crypto helpers, audit helper
│   └── prisma/
│       ├── schema.prisma
│       ├── migrations/
│       └── seed.ts
├── docker-compose.yml
├── docker-compose.test.yml  # ephemeral Postgres for backend test suite
├── nginx/                   # reverse proxy conf (optional compose profile)
├── .env.example
├── .gitignore
└── README.md, ARCHITECTURE.md, API.md, SECURITY.md, DEPLOYMENT.md
```

Layering rule: Routes → Controllers → Services → Prisma. No business logic in
route handlers or controllers.

## 4. Architecture

```
Browser → Next.js (SSR/CSR) → HTTPS/REST → Express API → Prisma → PostgreSQL
```

Frontend never touches the database directly. All data access goes through
the REST API.

## 5. Authentication

- Local auth: Argon2 password hashing (never bcrypt-only fallback, never
  plaintext).
- On login, backend issues a short-lived **access JWT** (~15 min) and a
  longer-lived **refresh JWT** (~7 days), both set as `httpOnly`, `secure`,
  `sameSite=lax` cookies. No tokens are ever returned in the JSON body.
- `POST /api/auth/logout` clears both cookies (and can be extended to a
  server-side refresh-token blacklist later; not required for v1).
- `GET /api/auth/me` returns the current user + role + permissions, derived
  from the access token.
- Express `requireAuth` middleware verifies the access cookie and loads the
  user; a silent-refresh flow using the refresh cookie re-issues an access
  token when it has expired.
- Next.js middleware checks for the presence of the access-token cookie to
  redirect unauthenticated users away from protected routes. This is a UX
  convenience only — the backend independently re-checks auth and
  permissions on every request and is the sole source of truth.
- `User` model includes `authProvider` ("local" | future "oidc") and
  `providerId` (nullable) so a company SSO/OIDC provider can be added later
  by populating the same table, without a schema migration for the core
  flow.
- Rate limiting (`express-rate-limit`) on `/api/auth/login`.

## 6. RBAC

- `Role` and `Permission` tables, many-to-many via `RolePermission`. Roles
  are not hardcoded in application code — they're seeded data — but the
  three initial roles and their permission sets are exactly as specified:

  - **Admin**: manage users, manage roles, create/edit/delete server, upload
    key, download key, delete key, create inventory entity, manage
    inventory, view audit logs.
  - **Operator**: view servers, create server, edit server, upload key,
    assign key, manage inventory, view relevant audit logs.
  - **Viewer**: view servers, view inventory, view non-sensitive metadata.
    Explicitly **cannot** download private SSH keys.

- `requirePermission('permission:key')` Express middleware loads the
  authenticated user's role's permissions and rejects with 403 if missing.
  Every mutating and sensitive-read route is wrapped in this middleware —
  the frontend hiding a button is never the enforcement mechanism.

## 7. SSH Key Security

- `StorageProvider` interface in `backend/src/storage/`:
  ```ts
  interface StorageProvider {
    put(id: string, plaintext: Buffer): Promise<{ storageRef: string; iv: string; authTag: string }>
    get(storageRef: string): Promise<Buffer>  // returns still-encrypted bytes
    delete(storageRef: string): Promise<void>
  }
  ```
- v1 implementation: `LocalFilesystemStorageProvider`, writing to a mounted
  Docker volume. AES-256-GCM authenticated encryption; the key comes from
  the `ENCRYPTION_KEY` env var (never hardcoded, never committed). IV and
  auth tag are stored alongside metadata in Postgres so decryption is
  possible without touching the file for anything but the raw ciphertext.
- Swapping to S3/MinIO later means adding a new class implementing the same
  interface — no service-layer changes.
- `SSHKey` table stores metadata only: name, type, description, owner,
  createdAt, lastAccessedAt, assignedServerId, storageRef, iv, authTag. No
  key material in Postgres, ever.
- Download flow (`GET /api/keys/:id/download`) enforces, in order:
  1. `requireAuth`
  2. `requirePermission('key:download')`
  3. Key exists (404 if not)
  4. Caller is authorized for this specific key (role permission; Viewer is
     blocked at step 2 already)
  5. Write `AuditLog` row (`KEY_DOWNLOAD`, user, key id, ip, user-agent) —
     write happens before the decrypted bytes are returned, so a crash
     mid-response still leaves an audit trail
  6. Decrypt via `StorageProvider.get` + AES-GCM decrypt
  7. Stream the file as `application/octet-stream` with
     `Content-Disposition: attachment` — never inside a JSON payload
- Private key contents are never written to any log statement, error
  message, or audit `metadata` field.
- Upload: multipart, validated for file type/size (reasonable cap, e.g. 64KB)
  before touching the storage layer.

## 8. Dynamic Inventory

Metadata-driven — no per-entity Postgres tables are created at runtime.

- `InventoryEntity` (id, name, description, createdBy, timestamps)
- `InventoryField` (id, entityId, fieldName, fieldType, required, options
  JSONB for select choices, displayOrder, timestamps) — fieldType ∈ {text,
  number, boolean, date, select, textarea}
- `InventoryRecord` (id, entityId, data JSONB, createdBy, timestamps)

Frontend fetches an entity's field definitions and renders the create/edit
form and table dynamically from that schema — no per-entity frontend code.

## 9. Audit Logging

Single `AuditLog` table: id, userId, action, resourceType, resourceId,
ipAddress, userAgent, metadata JSONB, createdAt. A small `auditService.log()`
helper is called from services (not scattered `prisma.auditLog.create` calls)
so the shape stays consistent. Actions logged exactly as listed in the
original spec (login/logout, server CRUD, key upload/download/delete/assign,
inventory CRUD, user CRUD, permission changes). `metadata` never contains
secrets or key material — enforced by convention + code review checklist in
SECURITY.md, since there's no automatic redaction layer in v1.

## 10. Database Schema Notes

UUID primary keys throughout. Indexes on: `hostname`, `ipAddress`,
`environment`, `os` (Server); `entityId` (InventoryRecord, InventoryField);
`userId` (AuditLog); `createdAt` (AuditLog, Server). Unique constraints on
`hostname` (Server), `name` (Role, InventoryEntity), `email` (User).

## 11. REST API

Exactly the endpoints listed in the original request (section 16): auth,
servers, keys (+ `/assign`, `/download`), inventory (entities + records),
users, audit-logs. All request bodies validated with Zod schemas shared
between route and service layers where practical.

## 12. Frontend Pages

Exactly the routes listed in the original request (section 17), under a
shared dashboard layout (sidebar, header, user menu, breadcrumbs, responsive).

## 13. Testing

- **Backend**: Jest + Supertest against a real Postgres (docker-compose test
  profile / `docker-compose.test.yml`), since Prisma's guarantees don't hold
  against a mocked DB. Covers: auth (login, hashing, cookie issuance),
  RBAC middleware, server CRUD, inventory CRUD, key upload, key download
  authorization (all 3 roles), audit log writes.
- **Frontend**: Vitest + React Testing Library. Covers: login form,
  server form Zod validation, inventory entity/field creation flow, key
  management UI (list, upload dialog, permission-gated download button).
- No test result is reported as passing without actually having been run.

## 14. Docker & Deployment

`docker-compose.yml` with `frontend`, `backend`, `postgres` services, health
checks on `postgres` (pg_isready) and `backend` (`/api/health`). Nginx
config provided as an optional reverse-proxy profile, not required to run
locally. `.env.example` lists `DATABASE_URL`, `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `PORT`, `NEXT_PUBLIC_API_URL`,
`KEY_STORAGE_PATH`. No secret ever hardcoded; `.gitignore` excludes `.env`
and the key storage volume path.

## 15. Non-Goals for v1

- Real S3/MinIO storage backend (interface supports it later).
- Server-side refresh-token revocation list / full session management UI.
- OIDC/SSO wired up (only the schema hook for it).
- Multi-tenancy.

## 16. Implementation Order

Exactly the Phase 1–10 order specified in the original request:

1. Project setup
2. PostgreSQL + Prisma schema
3. Authentication + RBAC
4. Server Inventory
5. SSH Key Management
6. Audit Logging
7. Dynamic Inventory
8. Dashboard
9. Testing
10. Docker + Documentation

Each phase is verified (typecheck, lint, relevant tests, Prisma
validate/migrate, build) before moving to the next — no phase is declared
done on unverified claims.
