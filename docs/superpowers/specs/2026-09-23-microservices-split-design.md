# Split into Auth/Inventory/Audit Microservices — Design

Date: 2026-09-23
Status: Approved for planning

## 1. Purpose

Restructure ServerManagementSystem from a single Express backend into three
independently buildable, independently deployable services, each owning its
own database and its own container. This is explicitly a learning/practice
exercise: the user is learning AWS and wants hands-on microservices
deployment experience, plus reusable patterns for a future larger
application — not a response to any current scaling problem.

**Explicitly out of scope for this round** (deferred to a future
brainstorm once an AWS compute target is chosen): ECS/EKS/Lambda decision,
Terraform/CDK, ECR, VPC/networking, CI/CD pipeline, secrets manager,
autoscaling, monitoring/observability tooling. This round's deliverable is
three services that run correctly together locally via `docker-compose`,
ready to hand to whichever AWS target comes next.

## 2. Service boundaries

| Service | Owns (Prisma models) | Owns (routes) |
|---|---|---|
| `auth-service` | `User`, `Role`, `Permission`, `RolePermission` | `/api/auth/*`, `/api/users/*`, `/api/roles/*` |
| `inventory-service` | `InventoryEntity`, `InventoryField`, `InventoryRecord` | `/api/inventory/*` |
| `audit-service` | `AuditLog` | `/api/audit-logs/*` |

`frontend/` is unchanged — still one Next.js app, still calling one base
URL (now the gateway, see §6).

The current `dashboardService.ts` / `dashboardController.ts` /
`dashboardRoutes.ts` and the `GET /api/dashboard` endpoint are **deleted
outright** — see §5.

## 3. Database: one server, three databases

One Postgres server (one RDS instance once deployed to AWS), but three
separate **databases** on it — `auth_db`, `inventory_db`, `audit_db` — not
Postgres schemas within one database. This is a deliberate refinement of
"separate schemas": a separate database per service is stronger isolation
(a service's Postgres role can be scoped so it physically cannot connect to
another service's database) and needs no Prisma `multiSchema` preview
feature or `@@schema(...)` annotations — each service is just a normal,
single-schema Prisma project pointed at its own `DATABASE_URL`.

Cross-service references become plain scalar columns, never Prisma
relations (Prisma cannot relate models that live in different
schema.prisma files/database connections):
- `InventoryEntity.createdById` / `InventoryRecord.createdById`: `String`
  (was `String` + `createdBy User @relation(...)` — the relation field is
  removed, the scalar column stays).
- `AuditLog.userId`: `String?` (same change — relation removed, scalar
  stays).

**Local dev bootstrap**: a `docker-entrypoint-initdb.d` init script on the
`postgres` container creates the three databases on first boot:
```sql
CREATE DATABASE auth_db;
CREATE DATABASE inventory_db;
CREATE DATABASE audit_db;
```
Each service's `DATABASE_URL` in `docker-compose.yml` points at the same
`postgres` host/port/credentials, differing only in database name.

## 4. Auth: stateless JWT verification

Today, `signAccessToken`/`signAccessToken` embed `{ sub, roleId }` only,
and `requireAuth` calls `getUserById()` (a DB read) on every request to
load the full user + role + permissions. That DB read is unavailable
outside `auth-service`.

**Change**: at sign-in, `auth-service` embeds the full authorization
picture directly in the JWT payload:
```ts
export interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}
```
`inventory-service` and `audit-service` get a new, much smaller
`requireAuth` middleware that only verifies the JWT signature (shared
`JWT_SECRET` env var across all three services) and reads `req.user` off
the decoded payload — no database call, no network call to `auth-service`,
per request. `requirePermission` is unchanged (`req.user.permissions.includes(key)`).

`auth-service` keeps today's DB-backed `requireAuth` for its own routes
(it already has the User table locally, and routes like `PUT
/users/:id/role` need to reflect permission changes immediately, not wait
for token refresh).

**Trade-off (accepted)**: a permission change takes effect for an
already-logged-in user only once their 15-minute access token expires and
silently refreshes — refresh tokens are still verified the same way,
re-signing a fresh access token with the user's *current* DB role/permissions
(refresh still happens against `auth-service`, which does have DB access).

## 5. Cross-service data: no server-side joins

Two places in the current code join across what will become service
boundaries:

**Audit logging** (`logAudit()` called in-process from
`inventoryController.ts`, `authController.ts`, `userController.ts`):
becomes an HTTP call from the calling service to `audit-service`:
```ts
// shared by auth-service and inventory-service
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    await fetch(`${process.env.AUDIT_SERVICE_URL}/internal/audit-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    console.warn('audit log write failed (non-fatal):', err);
  }
}
```
This is **best-effort**: a failed or slow `audit-service` never fails the
caller's actual request (record creation, login, etc. all succeed
regardless). `audit-service` exposes `POST /internal/audit-logs` as an
unauthenticated-but-only-reachable-within-the-docker-network endpoint (no
`requireAuth` — it's service-to-service, not user-facing). The public
`GET /api/audit-logs` (used by the Audit Logs page) keeps requiring
`audit:view` via the JWT-based `requireAuth`.

**Dashboard aggregation** (today, one backend endpoint queries
`InventoryEntity`/`InventoryRecord`/`User` counts directly): becomes a
frontend-side composition. `frontend/app/(app)/dashboard/page.tsx` fires
two parallel requests — a new `GET /api/inventory/stats` on
`inventory-service` returning `{ totalEntities, totalRecords }`, and a new
`GET /api/users/count` on `auth-service` returning `{ totalUsers }` — and
combines them with `Promise.all` before rendering the three stat cards.
No backend service aggregates across databases. Both new endpoints are
gated by `requireAuth` only (no `user:manage`/`inventory:manage`
permission check) since the Dashboard page itself has no permission gate
today — any logged-in user, including Viewer, can see it.

**Displaying a user's name next to their content** (audit log entries'
`user` field, currently resolved via a Prisma `include` in the same
query): `AuditLog` rows only ever store `userId` going forward — no
`include` is possible once `User` lives in a different database. Today,
anyone with `audit:view` (Admin *and* Operator) sees resolved names in
the audit log list, but the existing `GET /api/users` and `GET
/api/users/:id` on `auth-service` are gated by `user:manage`
(Admin-only) — pointing the frontend at those directly would regress
Operator's ability to see names. **Fix**: add a new endpoint,
`GET /api/users/lookup?ids=id1,id2,...` on `auth-service`, returning
`[{ id, name, email }]` for the requested IDs, gated by `requireAuth`
only (any authenticated user — it exposes no sensitive fields, just
display names). The Audit Logs page collects the distinct `userId`s from
the current page of results, calls this lookup endpoint once, and joins
by ID client-side before rendering.

## 6. Local routing: nginx gateway

An `nginx` container becomes the single entry point, replacing direct
access to the (formerly single) Express app on port 4000:

```nginx
# nginx/nginx.conf
server {
  listen 80;

  location /api/auth/     { proxy_pass http://auth-service:4001; }
  location /api/users/    { proxy_pass http://auth-service:4001; }
  location /api/roles/    { proxy_pass http://auth-service:4001; }
  location /api/inventory/{ proxy_pass http://inventory-service:4002; }
  location /api/audit-logs/ { proxy_pass http://audit-service:4003; }
}
```
The frontend's `NEXT_PUBLIC_API_URL` now points at the nginx container
(`http://localhost:8080` locally, mapped from nginx's port 80) instead of
directly at a backend. **No frontend code changes are needed** —
`frontend/lib/apiClient.ts` already builds requests as
`${API_URL}${path}` with paths like `/api/inventory/...`, so redirecting
`API_URL` at the gateway is a one-line env var change.

This is also exactly the shape an AWS Application Load Balancer (path-based
routing rules) or API Gateway (route mappings) will take later, so the
path-routing table designed here transfers directly.

## 7. Repository layout

```
ServerManagementSystem/
├── frontend/                 # unchanged
├── auth-service/
│   ├── src/
│   │   ├── routes/           # authRoutes, userRoutes, roleRoutes
│   │   ├── controllers/
│   │   ├── services/         # authService, userService, passwordService, tokenService
│   │   ├── middleware/       # requireAuth (DB-backed), requirePermission
│   │   └── lib/prisma.ts
│   ├── prisma/schema.prisma  # User, Role, Permission, RolePermission
│   ├── tests/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── inventory-service/
│   ├── src/
│   │   ├── routes/inventoryRoutes.ts
│   │   ├── controllers/inventoryController.ts
│   │   ├── services/inventoryService.ts, secretCrypto.ts, auditClient.ts
│   │   ├── storage/StorageProvider.ts, LocalFilesystemStorageProvider.ts
│   │   ├── middleware/requireAuth.ts (JWT-only), requirePermission.ts
│   │   └── lib/prisma.ts
│   ├── prisma/schema.prisma  # InventoryEntity, InventoryField, InventoryRecord
│   ├── tests/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── audit-service/
│   ├── src/
│   │   ├── routes/auditRoutes.ts (+ internal write route)
│   │   ├── controllers/auditController.ts
│   │   ├── services/auditService.ts
│   │   ├── middleware/requireAuth.ts (JWT-only), requirePermission.ts
│   │   └── lib/prisma.ts
│   ├── prisma/schema.prisma  # AuditLog
│   ├── tests/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── nginx/
│   └── nginx.conf
├── backend/                  # deleted once the split is verified working
├── docker-compose.yml        # rewritten: postgres, auth-service, inventory-service, audit-service, nginx, frontend
└── docs/, .gitignore, etc.   # unchanged
```

Each service is a fully independent Node/TypeScript project (own
`package.json`, own `node_modules`, own `tsconfig.json`, own Jest config,
own Prisma client) — matching the existing repo convention of "no npm
workspaces" already used between `backend/` and `frontend/`.
`requireAuth.ts` and `requirePermission.ts` are small enough (a dozen
lines each) that they're duplicated verbatim into `inventory-service` and
`audit-service` rather than extracted into a shared package — introducing
a shared internal npm package is unnecessary complexity for a 3-service
learning project and would itself need its own build/publish step.

## 8. What moves where (from `backend/`)

- `backend/src/routes/authRoutes.ts`, `userRoutes.ts`, `roleRoutes.ts` →
  `auth-service/src/routes/`
- `backend/src/controllers/userController.ts` (handles both user and role
  listing today) → `auth-service/src/controllers/`
- `backend/src/services/authService.ts`, `userService.ts`,
  `passwordService.ts`, `tokenService.ts` → `auth-service/src/services/`
  (`tokenService.ts`'s `AccessTokenPayload` gains `roleName`/`permissions`
  per §4)
- `backend/src/schemas/userSchemas.ts` → `auth-service/src/schemas/`
- New on `auth-service`: `GET /api/users/count` (`{ totalUsers }`) and
  `GET /api/users/lookup?ids=...` (`[{ id, name, email }]`), both gated by
  `requireAuth` only — see §5.
- `backend/src/routes/inventoryRoutes.ts`,
  `controllers/inventoryController.ts`,
  `services/inventoryService.ts`, `schemas/inventorySchemas.ts`,
  `lib/secretCrypto.ts`, `storage/*` → `inventory-service/src/...`
  unchanged in logic, only `requireAuth.ts` swapped for the JWT-only
  version and a new `services/auditClient.ts` added (the `logAudit` HTTP
  wrapper from §5)
- New on `inventory-service`: `GET /api/inventory/stats`
  (`{ totalEntities, totalRecords }`), gated by `requireAuth` only — see §5.
- `backend/src/routes/auditRoutes.ts`, `controllers/auditController.ts`,
  `services/auditService.ts`, `schemas/auditSchemas.ts` →
  `audit-service/src/...`, plus a new internal write route/handler
  (`POST /internal/audit-logs`, no auth — reachable only within the
  docker network, see §5)
- `backend/src/services/dashboardService.ts`,
  `controllers/dashboardController.ts`, `routes/dashboardRoutes.ts` →
  deleted (§5)
- `backend/prisma/seed.ts` → split into `auth-service/prisma/seed.ts`
  (permissions, roles, admin user — everything it does today) and
  deleted from the other two services (they have nothing to seed)
- `backend/src/middleware/errorHandler.ts` → copied verbatim into all
  three services (it's generic, no Server/SSHKey-specific logic left in
  it already)

## 9. Testing

Each service keeps its own Jest suite, run against its own database
(`auth_db_test`, etc., or the same three databases reused — matching
today's convention of one shared dev Postgres for integration tests, just
now three shared dev databases instead of one).

Cross-service integration (e.g., "does `inventory-service` correctly call
`audit-service` when a record is created?") is tested with a lightweight
fake: `inventory-service`'s tests point `AUDIT_SERVICE_URL` at a
`nock`-style HTTP mock or a tiny in-test Express stub, asserting the
correct payload was POSTed — not by spinning up the real `audit-service`
in the Jest run. A small number of true end-to-end checks (start all
services via `docker-compose`, hit the gateway, assert a record's audit
entry actually lands in `audit_db`) are done manually / via the live
browser walkthrough at the end, matching how this project has verified
Docker-composed behavior throughout — not as part of the automated Jest
suites.

## 10. Migration approach

Since `backend/` currently holds the single source of truth, the safest
order is: build all three new services from copies of `backend/`'s code,
get everything passing with `docker-compose` running the new 6-container
topology side-by-side verified working, *then* delete `backend/`. At no
point does `backend/` and the new services run against the same database
simultaneously — the old `backend/` container is stopped before the new
services' first `docker-compose up`, and the three new databases start
empty (re-seeded by `auth-service/prisma/seed.ts`), matching how this
project has treated its dev data throughout ("safe to drop" was already
established for this database).

## 11. Out of scope (explicitly deferred)

- AWS compute target (ECS/EKS/Lambda) and everything that follows from
  picking one: Terraform/CDK, ECR, VPC/subnets/security groups, ALB or
  API Gateway, CI/CD pipeline, AWS Secrets Manager, autoscaling,
  CloudWatch/observability.
- A shared internal package for `requireAuth`/`requirePermission` (small
  duplication is fine at 3 services).
- Async messaging (SQS/SNS/EventBridge) for audit logging — best-effort
  synchronous HTTP is enough for 3 services and no real load.
- Per-service independent CI (still one GitHub repo, no per-service
  release versioning yet).
