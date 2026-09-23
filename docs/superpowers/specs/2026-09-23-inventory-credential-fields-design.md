# Fold Servers/SSH Keys into Dynamic Inventory — Design

Date: 2026-09-23
Status: Approved for planning

## 1. Purpose

Remove the dedicated "Servers" and "SSH Keys" features (nav items, pages,
Prisma models, permissions) and replace server/credential management
entirely with the existing, schema-flexible "Dynamic Inventory" feature.
Users design their own tables (e.g. "Linux Servers", "Windows Servers",
"Finance BU Servers") with whatever fields they need, including two new
field types that store an SSH private key or a Windows password securely.

This removes a whole parallel subsystem (Server/SSHKey) in favor of one
generic system, matching the point of Dynamic Inventory being
user-defined. No production data exists in the current Server/SSHKey
tables, so no migration is required — the old tables are dropped.

## 2. Scope

**Removed entirely:**
- Prisma models `Server`, `SSHKey`; enums `OperatingSystem`, `Environment`,
  `ServerStatus`, `KeyFormat`; `User.createdServers` / `User.sshKeys`
  relations.
- Backend: `serverService.ts`, `serverController.ts`, `serverRoutes.ts`,
  `serverSchemas.ts`, `lib/serverSelect.ts`, `keyService.ts`,
  `keyController.ts`, `keyRoutes.ts`, `keySchemas.ts`, their mounts in
  `app.ts`.
- Frontend: `app/(app)/servers/**`, `app/(app)/keys/**`,
  `components/servers/**`, `types/server.ts`, `types/key.ts`, the
  "Servers"/"SSH Keys" entries in `components/layout/Sidebar.tsx`.
- Permissions `server:view/create/edit/delete` and
  `key:view/upload/download/delete/assign` from `prisma/seed.ts`.
- Backend tests `servers.test.ts` and `keys.test.ts` (their coverage is
  superseded by the new inventory-credentials tests in §10).
- Dashboard "Recent Activity" section and all Server/SSHKey stat cards.

**Kept and reused (generic, not Server/SSHKey-specific):**
- `backend/src/lib/secretCrypto.ts` (AES-256-GCM for small secrets).
- `backend/src/storage/{StorageProvider,LocalFilesystemStorageProvider}.ts`
  (encrypted file blob storage).
- `AUDIT_ACTIONS.CREDENTIAL_VIEWED` (re-pointed at `InventoryRecord`).

## 3. Data model

`FieldType` enum gains two values: `SSH_KEY`, `PASSWORD`. No other schema
changes — `InventoryRecord.data` (already a `Json` column) holds the
values for these fields too, using a fixed envelope shape:

```ts
// stored inside data[fieldName] when the field's type is PASSWORD
{ ciphertext: string; iv: string; authTag: string }

// stored inside data[fieldName] when the field's type is SSH_KEY
{ storageRef: string; iv: string; authTag: string; keyFormat: 'PEM' | 'PPK' }
```

The SSH key's actual bytes live in the filesystem-backed encrypted store
(`LocalFilesystemStorageProvider`), addressed by `storageRef`, exactly like
today's SSH key uploads — only the pointer sits in the JSON blob.

A table designer can add any number of SSH_KEY/PASSWORD fields to any
entity; there is no template and no restriction tying a field type to a
particular OS — that association is purely by convention in how the user
names their table and fields (e.g. a "Windows Servers" table happens to
have a PASSWORD field plus a plain TEXT "username" field; a "Linux
Servers" table happens to have an SSH_KEY field).

## 4. Never leaking secrets

`InventoryRecord.data` is untyped JSON, so there is no Prisma `select` to
lean on (unlike the earlier `SERVER_SELECT` fix). Instead, a single
sanitizer function in `inventoryService.ts`:

```ts
function sanitizeRecordData(
  fields: { fieldName: string; fieldType: FieldType }[],
  data: Record<string, unknown>,
): Record<string, unknown>
```

runs on every record before it leaves the service layer (list, get,
create, update). For each field whose `fieldType` is `SSH_KEY` or
`PASSWORD`, it replaces the stored envelope with a safe placeholder:
- `SSH_KEY` → `{ hasValue: true, keyFormat }` (format isn't sensitive)
- `PASSWORD` → `{ hasValue: true }`

No route ever returns `ciphertext`/`iv`/`authTag`/`storageRef` in a normal
response. A regression test asserts this the same way the earlier
`servers.test.ts` regression test did (substring search across the
serialized JSON response).

## 5. Revealing a secret

New permission: `inventory:credential:reveal`, granted to Admin and
Operator by default (not Viewer) — the same split `key:download` had.

New route: `GET /api/inventory/records/:id/fields/:fieldName/reveal`.
- Validates `fieldName` is a real field on the record's entity and that
  its `fieldType` is `SSH_KEY` or `PASSWORD`; 404/400 otherwise.
- `PASSWORD` → decrypts via `secretCrypto.decryptSecret`, responds
  `{ fieldType: 'PASSWORD', value: string }`.
- `SSH_KEY` → decrypts the file via `LocalFilesystemStorageProvider.get`,
  responds as a file download (`Content-Type: application/octet-stream`,
  `Content-Disposition: attachment`), same as the old key-download route.
- Every reveal is audit-logged: `AUDIT_ACTIONS.CREDENTIAL_VIEWED`,
  `resourceType: 'InventoryRecord'`, metadata `{ fieldName }`.

## 6. Create/update records with secret fields

`POST /api/inventory/entities/:id/records` and
`PUT /api/inventory/records/:id` accept `multipart/form-data` in addition
to plain JSON (via `multer.any()`, since field names are dynamic per
entity — unlike the old server-credential route, there's no fixed
`credentialFile` name to hardcode). The controller:
1. Parses the non-file fields from `req.body.data` (JSON-stringified,
   same convention the frontend already uses for `FormData` submissions).
2. For each `SSH_KEY` field present in `req.files`, validates the file
   looks like the declared `keyFormat` (reusing `looksLikeKeyFile`, moved
   from `keyService.ts` into `inventoryService.ts` since `keyService.ts`
   is being deleted), stores it via `LocalFilesystemStorageProvider.put`,
   and writes the `{ storageRef, iv, authTag, keyFormat }` envelope into
   `data[fieldName]`.
3. For each `PASSWORD` field present as a plain string in `data`,
   encrypts it via `secretCrypto.encryptSecret` and writes the
   `{ ciphertext, iv, authTag }` envelope into `data[fieldName]`.
4. All other fields go through the existing `buildRecordDataSchema`
   validation unchanged. `buildRecordDataSchema` skips SSH_KEY/PASSWORD
   keys entirely (they're handled by steps 2–3, not generic zod
   coercion).
5. On update, omitting a secret field's file/value leaves the existing
   stored envelope untouched (matches "edit doesn't force re-upload"
   behavior); there is no in-place "clear credential" action in this
   pass — deleting the whole record remains the way to remove one.

Failure cases (missing file for a value the client attempted to set,
unrecognized file format) return 400, mirroring `InvalidCredentialError`
from the old server-creation flow.

## 7. Frontend

- **Entity field builder** (the "Create Inventory Entity" dialog): field
  type dropdown gains "SSH Key" and "Password" options.
- **`DynamicRecordForm`**: new render branches —
  - `SSH_KEY`: a PEM/PPK select plus a file input (only shown/required
    when the user chooses to set or replace the key).
  - `PASSWORD`: a password input (only shown/required when the user
    chooses to set or replace it) — existing values are never
    pre-filled, since the plaintext isn't available to the form.
  - Submission uses `FormData` (JSON-stringified `data` + any files)
    whenever the entity has at least one SSH_KEY field with a file
    attached; otherwise the existing plain-JSON POST/PUT is unchanged.
- **Record table view** (`app/(app)/inventory/[id]/page.tsx`): a column
  backed by an SSH_KEY/PASSWORD field renders "•••• (view)" instead of
  the raw cell value. Clicking it opens a reveal dialog — a generalized
  version of the removed `ServerCredentialDialog` — gated on
  `inventory:credential:reveal`; hidden entirely for users without that
  permission.
- **Bulk import** (`ImportRecordsDialog`): columns in the uploaded
  CSV/Excel file whose header matches an SSH_KEY or PASSWORD field name
  are dropped before the parsed rows are sent to the bulk-import
  endpoint. The dialog's help text notes that credentials must be added
  per-record after import. The backend's `bulkCreateRecords` also
  ignores (does not error on) any SSH_KEY/PASSWORD key present in an
  imported row, as defense in depth.
- **Sidebar**: remove "Servers" and "SSH Keys" nav entries.

## 8. Dashboard

Remove the "Recent Activity" section and the 7 Server/SSHKey stat cards.
Replace with three stat cards: total inventory entities, total records
across all entities, total users. `dashboardService.ts`'s
`getDashboardStats()` is rewritten accordingly; `frontend/types/dashboard.ts`
and `app/(app)/dashboard/page.tsx` updated to match.

## 9. Migration

One Prisma migration:
- `DROP TABLE "Server"`, `DROP TABLE "SSHKey"` (cascades their FKs).
- `DROP TYPE "OperatingSystem"`, `"Environment"`, `"ServerStatus"`,
  `"KeyFormat"`.
- `ALTER TYPE "FieldType" ADD VALUE 'SSH_KEY'`, `ADD VALUE 'PASSWORD'`.
- Drop `createdServers`/`sshKeys` relation fields from `User` (no column
  change on `User` itself — these are relation-only fields).

Applied to the live dev Postgres the same way prior migrations were
(`npx prisma migrate dev`).

## 10. Testing

- Backend: new `backend/tests/inventory-credentials.test.ts` (or folded
  into `inventory.test.ts`) covering: creating an entity with an SSH_KEY
  field and uploading a valid/invalid key file; creating a PASSWORD field
  and round-tripping through the reveal endpoint; the leak-regression
  test (no `ciphertext`/`iv`/`authTag`/`storageRef` substrings in list/get
  responses); Viewer forbidden from the reveal endpoint;
  bulk-import silently dropping a secret-type column.
- Remove `backend/tests/servers.test.ts`, `backend/tests/keys.test.ts`.
  `backend/tests/secretCrypto.test.ts` stays unchanged (it tests the
  generic crypto helper, not the removed models).
- Frontend: update/replace `server-form.test.tsx`,
  `servers-list.test.tsx`, `keys-list.test.tsx`, `keys-upload.test.tsx`
  with equivalent coverage on `DynamicRecordForm`'s new field types and
  the record-list reveal button; `dynamic-record-form.test.tsx` and
  `entity-field-builder.test.tsx` gain cases for the two new field types.
- Full backend + frontend suites, lint, `tsc --noEmit`, and a production
  `next build` must pass before this is considered done, plus a live
  browser walkthrough (create a "Linux Servers" table with an SSH_KEY
  field, add a record with a key file, reveal it; same for a "Windows
  Servers" table with a PASSWORD field) mirroring how the credential
  feature was verified previously.

## 11. Out of scope (explicitly deferred)

- Per-Business-Unit access control (row/entity-level RBAC). Business Unit
  tables are just regular entities with a descriptive name; existing
  global Admin/Operator/Viewer roles govern access, same as any other
  inventory table.
- Built-in "Linux Server"/"Windows Server" starter templates. Table
  creation stays fully freeform.
- In-place "clear credential without deleting the record" action.
- Migrating any existing Server/SSHKey data (none exists).
