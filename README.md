# Server Inventory & Key Management Platform

An internal web application for managing server inventory, SSH keys, dynamic
custom inventory, users, roles, and audit logs.

## Purpose

Teams need a single place to track which servers exist, who owns them, which
SSH keys are assigned where, and who did what and when. This platform
provides:

- **Server inventory** — CRUD with search, filtering, sorting, and pagination.
- **SSH key management** — keys are encrypted at rest and only ever leave the
  server on an explicit, authorized, audited download.
- **Dynamic inventory** — admins define custom entities (e.g. "Network
  Devices", "Certificates") with their own field schemas, without a database
  migration per entity.
- **RBAC** — three roles (Admin, Operator, Viewer) enforced on every backend
  route, not just hidden in the UI.
- **Audit logging** — every sensitive action (login, server/key/inventory
  changes, permission changes) is recorded.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it's put together,
[API.md](API.md) for the REST reference, [SECURITY.md](SECURITY.md) for the
security model, and [DEPLOYMENT.md](DEPLOYMENT.md) for running it in Docker.

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for the full stack) — or a local PostgreSQL 16
  instance if you'd rather run the apps directly
- npm

## Project Layout

```
backend/    Express + TypeScript API (Routes -> Controllers -> Services -> Prisma)
frontend/   Next.js (App Router) + TypeScript + Tailwind + shadcn-style components
docs/       Design specs and implementation plans (docs/superpowers/)
```

## Installation

```bash
git clone <this-repo>
cd ServerManagementSystem

cp .env.example .env               # root .env, used by docker compose
cp .env.example backend/.env       # backend reads its own .env for local (non-Docker) dev

cd backend && npm install
cd ../frontend && npm install
```

**Important:** replace the placeholder `ENCRYPTION_KEY` in both `.env` files
before doing anything with SSH keys — see
[Environment Variables](#environment-variables) below.

## Environment Variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | backend | Postgres connection string |
| `PORT` | backend | Express listen port (default `4000`) |
| `CORS_ORIGIN` | backend | Frontend origin allowed to send credentialed requests |
| `JWT_SECRET` | backend | Signs access tokens — 32+ random characters |
| `JWT_REFRESH_SECRET` | backend | Signs refresh tokens — different from `JWT_SECRET` |
| `ENCRYPTION_KEY` | backend | AES-256-GCM key for SSH key storage — **must** be a 64-character hex string (or base64 decoding to exactly 32 bytes); generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `KEY_STORAGE_PATH` | backend | Filesystem path for encrypted key blobs |
| `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD` | backend seed | Bootstrap Admin account created by `npm run prisma:seed` |
| `NEXT_PUBLIC_API_URL` | frontend | Backend base URL the browser calls |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | docker compose | Only used by the `postgres` service |

Full reference: [.env.example](.env.example).

## Database Migration

```bash
cd backend
npx prisma migrate dev      # local development — creates/applies migrations
npx prisma migrate deploy   # CI/production — applies existing migrations only
npm run prisma:seed         # creates the 3 roles, their permissions, and the initial Admin user
```

## Local Development (without Docker)

Requires a Postgres instance reachable at your `backend/.env`'s
`DATABASE_URL`.

```bash
cd backend && npm run dev     # http://localhost:4000
cd frontend && npm run dev    # http://localhost:3000
```

## Docker Deployment

```bash
docker compose up -d --build
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run prisma:seed
docker compose logs -f
docker compose down
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for health checks, volumes, and a network
caveat worth knowing about if you're behind a TLS-inspecting corporate proxy.

## Tests

```bash
cd backend && npm test    # Jest + Supertest against a real Postgres (see below)
cd frontend && npm test   # Vitest + React Testing Library
```

The backend test suite needs a real Postgres reachable at `DATABASE_URL` —
integration tests exercise actual Prisma queries and RBAC/auth flows rather
than mocking the database. A throwaway instance works fine:

```bash
docker run -d --name test-postgres -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory \
  -p 5432:5432 postgres:16-alpine
cd backend && npx prisma migrate deploy && npm test
docker stop test-postgres && docker rm test-postgres
```

As of this writing: 13 backend test suites (54 tests) covering auth, RBAC,
server CRUD, SSH key encryption/upload/download authorization, dynamic
inventory, users/roles, dashboard stats, and audit logging; 9 frontend test
files (16 tests) covering login, server form validation, the dynamic
inventory field builder and record form, the server/key/inventory list
pages, and the key upload flow.
