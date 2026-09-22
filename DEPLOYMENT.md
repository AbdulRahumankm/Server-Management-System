# Deployment

## Docker Compose (recommended)

Three services: `postgres`, `backend`, `frontend`.

```bash
cp .env.example .env      # edit values first -- see below
docker compose up -d --build
docker compose ps          # postgres and backend should report "healthy"
docker compose logs -f      # follow logs from all services
docker compose down         # stop and remove containers (volumes persist)
```

First run needs the schema applied and the initial Admin account seeded:

```bash
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run prisma:seed
```

Frontend: `http://localhost:3000`. Backend: `http://localhost:4000`.

## Required Environment Variables Before First Run

Copy `.env.example` to `.env` and set real values — the placeholders will
not work:

- **`ENCRYPTION_KEY`** — must be a real 64-character hex string (or base64
  decoding to exactly 32 bytes), not the literal placeholder text. Generate
  one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  SSH key upload/download will fail at runtime with a clear error if this
  is missing or the wrong length — it's checked on every use, not just at
  startup.
- **`JWT_SECRET`** / **`JWT_REFRESH_SECRET`** — distinct random strings,
  32+ characters each.
- **`ADMIN_EMAIL`** / **`ADMIN_INITIAL_PASSWORD`** — the account
  `prisma:seed` creates. Change the password after first login; there's no
  forced-rotation mechanism in v1.

Full variable reference: [README.md](README.md#environment-variables).

## Network Note: TLS-Inspecting Proxies

If you're deploying from a network that runs a TLS-inspecting middlebox
(Fortinet/Netskope-style corporate proxies are common culprits), both
`npm install`'s prebuilt-binary fetches (Prisma's query/schema engines) and
`apk add` inside the Docker build will fail with
`self-signed certificate in certificate chain` — the container's default
trust store doesn't include that proxy's re-signing CA.

Fix: export your proxy's root CA(s) to a PEM file and place a copy at
`backend/certs/extra-ca.pem` and `frontend/certs/extra-ca.pem` (both
gitignored — this is a local/network-specific artifact, never committed).
The Dockerfiles pick it up automatically (`NODE_EXTRA_CA_CERTS` for Node's
own TLS calls, plus appending it to the system CA bundle so `apk` trusts it
too). On a network without TLS inspection, leave those files absent — the
Dockerfile's `touch` step makes them empty, which is a no-op.

`node:20-alpine` also ships without OpenSSL, which independently makes
Prisma fall back to a network binary-target check — the Dockerfiles install
`openssl` in both the build and runtime stages to avoid that path entirely.

## Health Checks

- `postgres`: `pg_isready` every 5s.
- `backend`: `wget` against `GET /api/health` every 10s — must return
  `{"status":"ok"}`.
- `frontend`: no explicit healthcheck; `docker compose ps` shows it as
  `running` once the container starts (Next.js's own startup is fast and
  reliable enough that this hasn't warranted one).

`docker compose ps` reporting `postgres`/`backend` as `healthy` is the
signal the stack is actually usable, not just "containers exist."

## Volumes

- `postgres-data` — the database. Removing it (`docker compose down -v`)
  deletes all data: servers, keys (metadata only — see below), inventory,
  users, audit logs.
- `key-storage` — encrypted SSH key blobs (`backend`'s `KEY_STORAGE_PATH`).
  Removing this volume without also having backed up the keys means the
  encrypted files are gone even though the `SSHKey` metadata rows in
  Postgres would still reference them — back up both together or neither.

Routine `docker compose down` (without `-v`) preserves both volumes.

## Reverse Proxy (Optional)

Nginx isn't required to run the stack locally or to satisfy the health
checks above — it's an optional addition for a real deployment that needs
TLS termination, a single public hostname in front of both
frontend/backend, or request buffering/rate limiting at the edge. Point it
at `frontend:3000` for the app and `backend:4000/api` for the API, and
terminate TLS there since the containers themselves serve plain HTTP.

## Database Migrations in Production

Use `prisma migrate deploy` (applies existing migrations, doesn't generate
new ones or prompt) — never `prisma migrate dev` outside local development:

```bash
docker compose exec backend npx prisma migrate deploy
```
