# Docker + Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the full Docker Compose stack still runs end-to-end after 9 phases of additions since Phase 1's initial setup, then write the five required documentation files (README, ARCHITECTURE, API, SECURITY, DEPLOYMENT). This is Phase 10 — the final phase.

**Architecture:** No new application code. Task 1 is a verification task (docker compose up → migrate → seed → smoke-test real HTTP calls against every major route group). Tasks 2-6 are documentation, each written by reading back what was actually built in Phases 1-9 rather than restating the original request's aspirational spec — every endpoint, permission, and file path named in the docs must exist in the repo as of this commit.

**Tech Stack:** No new dependencies.

**Spec:** Original request §20-21 (Docker), §24 (Documentation).

## Global Constraints

- Documentation describes the system as built, not as originally requested — where an earlier phase made a deliberate scope decision that differs from a literal reading of the original request (e.g., `key:assign` not granted to Admin, dynamic inventory fields being immutable after entity creation, `key:view`/`server:view`/`inventory:view` added as permissions not originally named), the docs state the actual behavior and don't silently contradict it.
- No fabricated verification results — Task 1's docker compose run is actually executed and its real output reported, per this project's standing rule (`superpowers:verification-before-completion`).

---

## File Structure

```
README.md
ARCHITECTURE.md
API.md
SECURITY.md
DEPLOYMENT.md
```

---

### Task 1: Full Docker Compose stack verification

**Files:** none (verification only)

- [ ] **Step 1: Build and start the full stack**

```bash
docker compose up -d --build
docker compose ps
```

Expected: `postgres` and `backend` report `healthy`, `frontend` reports `running`.

- [ ] **Step 2: Run migration and seed inside the backend container**

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run prisma:seed
```

Expected: both exit 0.

- [ ] **Step 3: Smoke-test one route from each major group over real HTTP**

```bash
curl -s http://localhost:4000/api/health
curl -s -c /tmp/cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
curl -s -b /tmp/cookies.txt http://localhost:4000/api/auth/me
curl -s -b /tmp/cookies.txt http://localhost:4000/api/servers
curl -s -b /tmp/cookies.txt http://localhost:4000/api/keys
curl -s -b /tmp/cookies.txt http://localhost:4000/api/inventory/entities
curl -s -b /tmp/cookies.txt http://localhost:4000/api/dashboard
curl -s -b /tmp/cookies.txt http://localhost:4000/api/audit-logs
curl -s -b /tmp/cookies.txt http://localhost:4000/api/users
curl -s -b /tmp/cookies.txt http://localhost:4000/api/roles
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login
```

Expected: `/api/health` → `{"status":"ok"}`; login → 200 with `role: "Admin"`; every subsequent authenticated `GET` → 200 with valid JSON (empty arrays are fine — no data has been created in this container run beyond the seed); `/login` → `200`.

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: Report actual results**

State the real output from Steps 1-3 — don't claim the stack works without having run it.

---

### Task 2: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write it, covering:**
  - Project purpose (one paragraph: internal server inventory, SSH key management, dynamic inventory, RBAC, audit logging)
  - Architecture summary (one paragraph + link to ARCHITECTURE.md)
  - Prerequisites (Node 20+, Docker, Docker Compose)
  - Installation (clone, `.env` setup for both root and `backend/`, `npm install` in both `backend/` and `frontend/`)
  - Environment variables (table, cross-referencing `.env.example`)
  - Database migration (`npx prisma migrate dev` / `migrate deploy`, seed command)
  - Local development (running backend and frontend dev servers separately, without Docker)
  - Docker deployment (`docker compose up -d --build`, health check behavior)
  - Test commands (`npm test` in both `backend/` and `frontend/`, what each covers)
  - A link to the other four docs

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add project README"
```

---

### Task 3: ARCHITECTURE.md

**Files:**
- Create: `ARCHITECTURE.md`

- [ ] **Step 1: Write it, covering:**
  - High-level diagram in text: Browser → Next.js → REST/HTTPS → Express → Prisma → PostgreSQL
  - Backend layering (Routes → Controllers → Services → Prisma) with the actual directory structure under `backend/src/`
  - The `StorageProvider` abstraction for encrypted SSH key storage and why it's designed that way
  - The dynamic inventory design (`InventoryEntity`/`InventoryField`/`InventoryRecord`, JSONB, runtime Zod schema construction) and its v1 limitation (fields immutable after entity creation)
  - RBAC model (`Role`/`Permission`/`RolePermission`, `requireAuth`/`requirePermission` middleware) and where the actual permission set differs from the original request's literal per-role list (`key:view`/`server:view`/`inventory:view` added; `key:assign` not granted to Admin) — with the reasoning already captured in each phase's plan doc, summarized here
  - Frontend structure (App Router, TanStack Query for server state, the `apiFetch` wrapper, permission-gated UI via `useCurrentUser`)
  - A link to each phase's plan doc under `docs/superpowers/plans/` for implementation-level detail

- [ ] **Step 2: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: add architecture overview"
```

---

### Task 4: API.md

**Files:**
- Create: `API.md`

- [ ] **Step 1: Write it** — for every route actually mounted in `backend/src/app.ts`, document: method, path, required permission (or "authenticated only"), request body/query shape, response shape, and notable status codes (404/409/etc.). Cover, in this order: Auth, Servers, Keys, Inventory, Users, Roles, Audit Logs, Dashboard, Health. Explicitly call out that `GET /api/keys/:id/download` returns a binary file (`application/octet-stream`), never JSON, and that key metadata responses never include `storageRef`/`iv`/`authTag`.

- [ ] **Step 2: Commit**

```bash
git add API.md
git commit -m "docs: add REST API reference"
```

---

### Task 5: SECURITY.md

**Files:**
- Create: `SECURITY.md`

- [ ] **Step 1: Write it, covering:**
  - Password hashing (Argon2 via `@node-rs/argon2`)
  - Session handling (httpOnly/secure/sameSite JWT cookies, access+refresh, transparent refresh in `requireAuth`)
  - RBAC enforcement (backend-only, never trusts frontend hiding)
  - SSH key encryption at rest (AES-256-GCM, `ENCRYPTION_KEY` format requirement, `StorageProvider` abstraction, the 7-step download authorization sequence, audit-before-decrypt ordering)
  - Rate limiting on login
  - Input validation (Zod on every route)
  - File upload validation (size limit, PEM-marker content check)
  - Audit logging (what's logged, explicitly that secrets/key content are never logged, which actions are and aren't audited per the original request's list)
  - CORS/Helmet
  - What's *not* done in v1 and why (no MFA, no refresh-token revocation list, no S3 storage backend) — framed as documented scope, not omissions

- [ ] **Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add security documentation"
```

---

### Task 6: DEPLOYMENT.md

**Files:**
- Create: `DEPLOYMENT.md`

- [ ] **Step 1: Write it, covering:**
  - `docker compose up -d --build` / `down` / `logs` commands (from the original request's §20)
  - Required `.env` variables before first run, with the note that `ENCRYPTION_KEY` must be a real 64-hex-char (or base64) 32-byte value, not the `.env.example` placeholder
  - The corporate-network TLS-inspection workaround (`backend/certs/extra-ca.pem` / `frontend/certs/extra-ca.pem`, gitignored, only needed on networks that intercept TLS — documented so a future developer on the same network isn't stuck rediscovering it)
  - Health check behavior and how to verify the stack is up
  - Running migrations/seed against the Dockerized Postgres
  - Volumes (`postgres-data`, `key-storage`) and what's lost if they're removed
  - A note that Nginx as a reverse proxy is optional and not required to run locally (per the original request's §2, "Nginx can be added")

- [ ] **Step 2: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs: add deployment guide"
```

---

## Self-Review Notes

- **Spec coverage:** §20 Docker commands → Task 1 verification + DEPLOYMENT.md. §24's five required docs and their specified contents → Tasks 2-6.
- **No placeholders:** every doc is written from the actual, merged codebase — no "TBD" sections, no describing planned-but-unbuilt features as if they exist.
