# Security

## Password Storage

Passwords are hashed with Argon2 (`@node-rs/argon2` — prebuilt binaries
distributed as npm registry packages; used instead of the native `argon2`
package because this network's TLS-inspecting proxy breaks that package's
GitHub-release/node-gyp download paths). Plaintext passwords are never
stored, logged, or included in any API response.

## Session Handling

Local email/password auth. On login the backend issues two JWTs:

- **Access token** (~15 min TTL) — used to authenticate each request.
- **Refresh token** (~7 day TTL) — used only to silently re-issue an access
  token when it expires.

Both are set as `httpOnly`, `sameSite=lax`, and `secure` (in production)
cookies. **Neither token is ever returned in a JSON response body.**
`requireAuth` middleware verifies the access token on every request; if
it's expired but the refresh token is valid, it transparently issues a new
access token in the same response — the frontend never sees or handles
tokens directly.

`POST /api/auth/logout` clears both cookies and doesn't require a valid
session (so an already-expired session can still log out cleanly); it
best-effort identifies the user from the access token (if present and
valid) purely for the audit log entry.

`User.authProvider`/`providerId` exist in the schema so a company
SSO/OIDC provider can be integrated later by populating the same table —
no schema change needed for that integration path.

## Authorization (RBAC)

Enforced exclusively on the backend. Every mutating route and every
sensitive-read route is wrapped in `requirePermission('resource:action')`,
which checks the authenticated user's role's permission set (loaded from
`Role`/`Permission`/`RolePermission`) and returns `403` if the required
permission is missing. **The frontend hiding a button is never the
enforcement mechanism** — every permission check that gates UI also gates
the underlying API route, independently.

Three seeded roles: Admin, Operator, Viewer. See
[ARCHITECTURE.md](ARCHITECTURE.md#rbac) for the exact permission set each
holds and the two places it was adjusted from the original request's
literal per-role list during implementation (view permissions added to
Admin/Operator; `key:assign` deliberately withheld from Admin).

## SSH Key Encryption at Rest

- **Algorithm:** AES-256-GCM (authenticated encryption — both
  confidentiality and tamper detection) via Node's built-in `crypto`
  module. Verified by an explicit test
  (`backend/tests/localFilesystemStorageProvider.test.ts`) that a tampered
  auth tag causes decryption to throw rather than silently returning
  corrupted plaintext.
- **Key source:** `ENCRYPTION_KEY` environment variable — never hardcoded.
  Must decode to exactly 32 bytes (a 64-character hex string, or base64).
  The app throws on startup-of-first-use if it's missing or the wrong
  length, rather than silently using a weak or wrong-size key.
- **Storage abstraction:** `StorageProvider` interface (`put`/`get`/`delete`)
  — the v1 `LocalFilesystemStorageProvider` writes encrypted blobs to a
  Docker volume (`KEY_STORAGE_PATH`); swapping to S3/MinIO later means
  implementing the same interface, no service-layer changes.
- **Database:** `SSHKey` rows store only `storageRef` (a reference, not
  content), `iv`, and `authTag` — **never plaintext or ciphertext key
  material in Postgres.** Every Prisma query for key metadata uses an
  explicit `select` that excludes these three fields, so there is no code
  path — list, get, or otherwise — where they could leak into a JSON
  response.

### Download Authorization Sequence

`GET /api/keys/:id/download` enforces, in this exact order:

1. `requireAuth` — must be authenticated.
2. `requirePermission('key:download')` — **Viewer never has this
   permission and is rejected here**, before the key is even looked up.
3. Key existence check (`404` if not found).
4. (Permission already checked in step 2 — no separate per-key ACL in v1.)
5. **Audit event recorded** (`KEY_DOWNLOADED`, with user/key/IP/user-agent)
   — written before decryption, so a crash mid-response still leaves an
   audit trail.
6. Decryption.
7. Streamed as `application/octet-stream` with `Content-Disposition:
   attachment` — **never inside a JSON payload.**

### Upload Validation

- File size limited to 64KB (`multer`, memory storage — the buffer is
  encrypted before ever touching disk unencrypted).
- Content sanity check: the file must start with `-----BEGIN` (rejects
  obviously-wrong uploads; full key-format parsing is out of scope for v1).
- Multer's own size-limit rejection is mapped to a `400` (not a generic
  `500`) by the centralized error handler.

## Audit Logging

`auditService.logAudit()` is the single write path for every audited
action (login/logout, server/key/inventory CRUD, permission changes — full
list in [API.md](API.md#audit-logs)). **`metadata` never contains secrets
or key content** — verified by an explicit test assertion
(`backend/tests/audit.test.ts`) that a `KEY_DOWNLOADED` entry's metadata
never contains the string `BEGIN OPENSSH`. Only names, types, and IDs are
recorded.

## Input Validation

Every request body and query string is validated with Zod before touching
a service. Dynamic inventory records get an additional layer: their
validator is built *at request time* from the target entity's actual field
definitions, so a record write is checked against whatever fields that
entity currently has (required-ness, `NUMBER`/`BOOLEAN` coercion, `SELECT`
option membership).

## Rate Limiting

`POST /api/auth/login` is rate-limited (10 requests / 15 minutes per IP)
via `express-rate-limit`, to slow down credential-stuffing/brute-force
attempts.

## Transport & Headers

- `helmet` sets standard security headers on every response.
- CORS is restricted to `CORS_ORIGIN` (the frontend's origin) with
  `credentials: true`.
- The stack is HTTPS-ready — cookies are marked `secure` when
  `NODE_ENV=production`; TLS termination itself is expected to happen at a
  reverse proxy/load balancer in front of the containers (see
  [DEPLOYMENT.md](DEPLOYMENT.md)).

## SQL Injection

All database access goes through Prisma's parameterized query builder —
no raw SQL string concatenation anywhere in the codebase.

## Known v1 Scope Limits (Not Omissions)

These were explicit, documented decisions during implementation, not gaps
discovered after the fact:

- No MFA.
- No server-side refresh-token revocation list (logout clears cookies
  client-side; a stolen refresh token remains valid until it expires).
- No S3/real object storage backend for SSH keys — the `StorageProvider`
  abstraction exists specifically so this can be added later without
  touching business logic.
- No per-key access-control list beyond the role-level `key:download`
  permission.
- Dynamic inventory field definitions are immutable after entity creation
  (see [ARCHITECTURE.md](ARCHITECTURE.md#dynamic-inventory)).
