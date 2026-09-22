# SSH Key Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypted-at-rest SSH key storage, upload/list/download/delete/assign endpoints with strict RBAC, and the `/keys`, `/keys/upload` frontend pages. This is Phase 5 — the most security-sensitive phase in the system.

**Architecture:** A `StorageProvider` interface owns both encryption and byte storage (`put` encrypts+writes, `get` reads+decrypts, `delete` removes) so the service layer never touches raw crypto or the filesystem directly, and swapping to S3 later means writing one new class. AES-256-GCM (authenticated encryption) via Node's built-in `crypto`, key from `ENCRYPTION_KEY` env. Private key bytes only ever leave the server on `GET /api/keys/:id/download`, streamed as `application/octet-stream` — never inside JSON, never logged.

**Tech Stack:** `multer` (multipart upload, memory storage so the buffer can be encrypted before ever touching disk unencrypted), Node's built-in `crypto`.

**Spec:** [docs/superpowers/specs/2026-09-22-server-inventory-platform-design.md](../specs/2026-09-22-server-inventory-platform-design.md) §7 SSH Key Security. Original request §8-9.

## Global Constraints

- Private key content is **never** returned in a JSON response, **never** logged, and **never** written to the database — only `storageRef`/`iv`/`authTag` (references, not content) are persisted in Postgres.
- Every metadata query (`prisma.sSHKey.findMany`/`findUnique`) uses an explicit `select` that excludes `storageRef`/`iv`/`authTag` — there's no route where a metadata response could accidentally include them.
- Download requires `requireAuth` → `requirePermission('key:download')` → key exists → decrypt → stream. No audit log yet (Phase 6 adds it here specifically, per the spec's own worked example of a `KEY_DOWNLOAD` audit event).
- Two RBAC decisions worth being explicit about, since they affect who can do what:
  - **`key:view` is a new permission**, not explicitly named in the original request's per-role permission lists, added here because upload/assign/download all require being able to see the key list first, and the original request's Viewer bullet "View non-sensitive metadata" plausibly covers key metadata (name/type/owner/dates — never content). Granted to all three roles.
  - **Admin does not get `key:assign`** — the original request's per-role permission lists (§11) give `key:assign` to Operator only, and Admin's list stops at "Upload key, Download key, Delete key" without "Assign key". This is followed literally rather than assumed away, unlike the `server:view` gap fixed in Phase 4 (which was an inconsistency in *this project's own* Phase 1 seed design, not something the original request specified either way).
- Upload validates: file size (≤64KB), and a light content sanity check (`-----BEGIN` prefix) — real key-format parsing is out of scope for v1.

---

## File Structure

```
backend/src/
├── storage/
│   ├── StorageProvider.ts            # interface
│   └── LocalFilesystemStorageProvider.ts
├── schemas/keySchemas.ts
├── services/keyService.ts
├── controllers/keyController.ts
└── routes/keyRoutes.ts
backend/tests/keys.test.ts

frontend/
├── types/key.ts
├── lib/useCurrentUser.ts             # GET /api/auth/me via TanStack Query, for permission-gated UI
├── app/keys/page.tsx
└── app/keys/upload/page.tsx
frontend/tests/keys-list.test.tsx
```

---

### Task 1: Add `key:view` permission and fix seed test counts

**Files:**
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/tests/seed.test.ts`

- [ ] **Step 1: Add `'key:view'` to `PERMISSIONS` and to all three roles**

In `backend/prisma/seed.ts`, add `'key:view'` to the `PERMISSIONS` array, and add it to `ROLE_PERMISSIONS.Admin`, `.Operator`, and `.Viewer`. The full `ROLE_PERMISSIONS` object after this change:

```ts
const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  Admin: [
    'user:manage',
    'role:manage',
    'server:view',
    'server:create',
    'server:edit',
    'server:delete',
    'key:view',
    'key:upload',
    'key:download',
    'key:delete',
    'inventory:create',
    'inventory:manage',
    'audit:view',
  ],
  Operator: [
    'server:view',
    'server:create',
    'server:edit',
    'key:view',
    'key:upload',
    'key:assign',
    'inventory:manage',
    'audit:view',
  ],
  Viewer: ['server:view', 'key:view', 'inventory:view', 'audit:view'],
};
```

- [ ] **Step 2: Update expected counts in `backend/tests/seed.test.ts`**

```ts
    expect(admin?.permissions.length).toBe(13);
    expect(operator?.permissions.length).toBe(8);
    expect(viewer?.permissions.length).toBe(4);
```

- [ ] **Step 3: Run test** (against a real Postgres — see Task 4's verification step)

Run (from `backend/`): `npx jest tests/seed.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts backend/tests/seed.test.ts
git commit -m "feat(backend): add key:view permission for all roles"
```

---

### Task 2: Encrypted storage abstraction

**Files:**
- Create: `backend/src/storage/StorageProvider.ts`
- Create: `backend/src/storage/LocalFilesystemStorageProvider.ts`
- Test: `backend/tests/localFilesystemStorageProvider.test.ts`

**Interfaces:**
- Consumes: `ENCRYPTION_KEY`, `KEY_STORAGE_PATH` env vars (Phase 1).
- Produces: `StorageProvider` interface, `LocalFilesystemStorageProvider` — Task 4's `keyService` is the only consumer, and only ever talks to the `StorageProvider` interface, not this class directly.

- [ ] **Step 1: Create `backend/src/storage/StorageProvider.ts`**

```ts
export interface StorageProvider {
  put(id: string, plaintext: Buffer): Promise<{ storageRef: string; iv: string; authTag: string }>;
  get(storageRef: string, iv: string, authTag: string): Promise<Buffer>;
  delete(storageRef: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test — `backend/tests/localFilesystemStorageProvider.test.ts`**

```ts
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { LocalFilesystemStorageProvider } from '../src/storage/LocalFilesystemStorageProvider';

describe('LocalFilesystemStorageProvider', () => {
  let dir: string;
  let provider: LocalFilesystemStorageProvider;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'key-storage-test-'));
    provider = new LocalFilesystemStorageProvider(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips plaintext through encrypt-and-store then decrypt-and-read', async () => {
    const plaintext = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----');

    const { storageRef, iv, authTag } = await provider.put('test-key', plaintext);
    expect(storageRef).toBeTruthy();

    const result = await provider.get(storageRef, iv, authTag);
    expect(result.equals(plaintext)).toBe(true);
  });

  it('never writes plaintext bytes to disk', async () => {
    const plaintext = Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nsecret-marker-xyz\n-----END RSA PRIVATE KEY-----');
    const { storageRef } = await provider.put('test-key-2', plaintext);

    const raw = await require('fs/promises').readFile(path.join(dir, storageRef));
    expect(raw.includes('secret-marker-xyz')).toBe(false);
  });

  it('fails to decrypt with a tampered auth tag', async () => {
    const plaintext = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----');
    const { storageRef, iv, authTag } = await provider.put('test-key-3', plaintext);
    const tamperedAuthTag = Buffer.from(authTag, 'base64');
    tamperedAuthTag[0] ^= 0xff;

    await expect(
      provider.get(storageRef, iv, tamperedAuthTag.toString('base64')),
    ).rejects.toThrow();
  });

  it('deletes the underlying file', async () => {
    const { storageRef } = await provider.put('test-key-4', Buffer.from('-----BEGIN x'));
    await provider.delete(storageRef);
    await expect(provider.get(storageRef, 'irrelevant', 'irrelevant')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `npx jest tests/localFilesystemStorageProvider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Create `backend/src/storage/LocalFilesystemStorageProvider.ts`**

```ts
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'crypto';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import type { StorageProvider } from './StorageProvider';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

function loadEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must decode to exactly 32 bytes -- a 64-character hex string or base64',
    );
  }
  return key;
}

export class LocalFilesystemStorageProvider implements StorageProvider {
  constructor(private readonly basePath: string = process.env.KEY_STORAGE_PATH ?? './key-storage') {}

  async put(id: string, plaintext: Buffer): Promise<{ storageRef: string; iv: string; authTag: string }> {
    await mkdir(this.basePath, { recursive: true });
    const key = loadEncryptionKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const storageRef = `${id}-${randomUUID()}.enc`;
    await writeFile(path.join(this.basePath, storageRef), encrypted);

    return { storageRef, iv: iv.toString('base64'), authTag: authTag.toString('base64') };
  }

  async get(storageRef: string, iv: string, authTag: string): Promise<Buffer> {
    const key = loadEncryptionKey();
    const encrypted = await readFile(path.join(this.basePath, storageRef));
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async delete(storageRef: string): Promise<void> {
    await unlink(path.join(this.basePath, storageRef));
  }
}
```

- [ ] **Step 5: Generate a real local `ENCRYPTION_KEY` for dev/test**

The `.env` value from Phase 1 (`dev-only-change-me-32-byte-hex-key`) is not a valid 32-byte key. Generate a real one and replace it in `backend/.env` (not `.env.example` — that stays a placeholder):

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Set `ENCRYPTION_KEY=<that output>` in `backend/.env`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/localFilesystemStorageProvider.test.ts`
Expected: PASS — 4 passed

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 8: Commit**

```bash
git add backend/src/storage backend/tests/localFilesystemStorageProvider.test.ts
git commit -m "feat(backend): add AES-256-GCM encrypted filesystem storage provider"
```

(`backend/.env` is gitignored — the real `ENCRYPTION_KEY` from Step 5 never gets committed.)

---

### Task 3: Key Zod schemas

**Files:**
- Create: `backend/src/schemas/keySchemas.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from 'zod';

export const uploadKeyMetadataSchema = z.object({
  name: z.string().min(1).max(255),
  keyType: z.enum(['rsa', 'ed25519', 'ecdsa', 'dsa']),
  description: z.string().max(2000).optional(),
});

export const assignKeySchema = z.object({
  serverId: z.string().uuid(),
});

export type UploadKeyMetadataInput = z.infer<typeof uploadKeyMetadataSchema>;
export type AssignKeyInput = z.infer<typeof assignKeySchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/keySchemas.ts
git commit -m "feat(backend): add Zod schemas for SSH key upload and assignment"
```

---

### Task 4: Key service, controller, routes, and integration tests

**Files:**
- Create: `backend/src/services/keyService.ts`
- Create: `backend/src/controllers/keyController.ts`
- Create: `backend/src/routes/keyRoutes.ts`
- Modify: `backend/src/middleware/errorHandler.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/keys.test.ts`

**Interfaces:**
- Consumes: `StorageProvider`/`LocalFilesystemStorageProvider` (Task 2), key schemas (Task 3), `requireAuth`/`requirePermission` (Phase 3).
- Produces: `keyRouter` mounted at `/api/keys`.

- [ ] **Step 1: Install multer**

Run (from `backend/`): `npm install multer && npm install --save-dev @types/multer`

- [ ] **Step 2: Create `backend/src/services/keyService.ts`**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { LocalFilesystemStorageProvider } from '../storage/LocalFilesystemStorageProvider';
import type { StorageProvider } from '../storage/StorageProvider';

const storage: StorageProvider = new LocalFilesystemStorageProvider();

export class KeyNotFoundError extends Error {}
export class DuplicateKeyNameError extends Error {}

const KEY_METADATA_SELECT = {
  id: true,
  name: true,
  keyType: true,
  description: true,
  ownerId: true,
  owner: { select: { id: true, name: true, email: true } },
  lastAccessedAt: true,
  createdAt: true,
  updatedAt: true,
  assignedServer: { select: { id: true, hostname: true } },
} satisfies Prisma.SSHKeySelect;
// storageRef/iv/authTag are intentionally excluded from every query below

export async function listKeys(search?: string) {
  return prisma.sSHKey.findMany({
    where: search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
    select: KEY_METADATA_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getKeyMetadata(id: string) {
  return prisma.sSHKey.findUnique({ where: { id }, select: KEY_METADATA_SELECT });
}

export async function uploadKey(input: {
  name: string;
  keyType: string;
  description?: string;
  ownerId: string;
  fileBuffer: Buffer;
}) {
  const { storageRef, iv, authTag } = await storage.put(input.name, input.fileBuffer);
  try {
    return await prisma.sSHKey.create({
      data: {
        name: input.name,
        keyType: input.keyType,
        description: input.description,
        ownerId: input.ownerId,
        storageRef,
        iv,
        authTag,
      },
      select: KEY_METADATA_SELECT,
    });
  } catch (err) {
    await storage.delete(storageRef).catch(() => undefined);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateKeyNameError();
    }
    throw err;
  }
}

export async function downloadKey(id: string): Promise<{ filename: string; content: Buffer }> {
  const key = await prisma.sSHKey.findUnique({ where: { id } });
  if (!key) throw new KeyNotFoundError();
  const content = await storage.get(key.storageRef, key.iv, key.authTag);
  await prisma.sSHKey.update({ where: { id }, data: { lastAccessedAt: new Date() } });
  return { filename: key.name, content };
}

export async function deleteKey(id: string): Promise<void> {
  const key = await prisma.sSHKey.findUnique({ where: { id } });
  if (!key) throw new KeyNotFoundError();
  await prisma.sSHKey.delete({ where: { id } });
  await storage.delete(key.storageRef).catch(() => undefined);
}

export async function assignKeyToServer(keyId: string, serverId: string) {
  const key = await prisma.sSHKey.findUnique({ where: { id: keyId } });
  if (!key) throw new KeyNotFoundError();
  return prisma.server.update({ where: { id: serverId }, data: { assignedKeyId: keyId } });
}
```

- [ ] **Step 3: Create `backend/src/controllers/keyController.ts`**

```ts
import { Request, Response } from 'express';
import { uploadKeyMetadataSchema, assignKeySchema } from '../schemas/keySchemas';
import {
  listKeys,
  getKeyMetadata,
  uploadKey,
  downloadKey,
  deleteKey,
  assignKeyToServer,
  KeyNotFoundError,
  DuplicateKeyNameError,
} from '../services/keyService';

const PRIVATE_KEY_MARKER = '-----BEGIN';

export async function listKeysHandler(req: Request, res: Response): Promise<void> {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  res.status(200).json(await listKeys(search));
}

export async function getKeyHandler(req: Request, res: Response): Promise<void> {
  const key = await getKeyMetadata(req.params.id);
  if (!key) {
    res.status(404).json({ error: 'Key not found' });
    return;
  }
  res.status(200).json(key);
}

export async function uploadKeyHandler(req: Request, res: Response): Promise<void> {
  const parsed = uploadKeyMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'A key file is required' });
    return;
  }
  if (req.file.buffer.subarray(0, PRIVATE_KEY_MARKER.length).toString('utf8') !== PRIVATE_KEY_MARKER) {
    res.status(400).json({ error: 'File does not look like a PEM-encoded private key' });
    return;
  }

  try {
    const key = await uploadKey({
      name: parsed.data.name,
      keyType: parsed.data.keyType,
      description: parsed.data.description,
      ownerId: req.user!.id,
      fileBuffer: req.file.buffer,
    });
    res.status(201).json(key);
  } catch (err) {
    if (err instanceof DuplicateKeyNameError) {
      res.status(409).json({ error: 'A key with this name already exists' });
      return;
    }
    throw err;
  }
}

export async function downloadKeyHandler(req: Request, res: Response): Promise<void> {
  try {
    const { filename, content } = await downloadKey(req.params.id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(content);
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}

export async function deleteKeyHandler(req: Request, res: Response): Promise<void> {
  try {
    await deleteKey(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}

export async function assignKeyHandler(req: Request, res: Response): Promise<void> {
  const parsed = assignKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(await assignKeyToServer(req.params.id, parsed.data.serverId));
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}
```

- [ ] **Step 4: Create `backend/src/routes/keyRoutes.ts`**

```ts
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listKeysHandler,
  getKeyHandler,
  uploadKeyHandler,
  downloadKeyHandler,
  deleteKeyHandler,
  assignKeyHandler,
} from '../controllers/keyController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 },
});

export const keyRouter = Router();

keyRouter.use(requireAuth);

keyRouter.get('/', requirePermission('key:view'), listKeysHandler);
keyRouter.post('/', requirePermission('key:upload'), upload.single('file'), uploadKeyHandler);
keyRouter.get('/:id', requirePermission('key:view'), getKeyHandler);
keyRouter.get('/:id/download', requirePermission('key:download'), downloadKeyHandler);
keyRouter.delete('/:id', requirePermission('key:delete'), deleteKeyHandler);
keyRouter.post('/:id/assign', requirePermission('key:assign'), assignKeyHandler);
```

- [ ] **Step 5: Make `errorHandler` return 400 on Multer errors**

Multer's file-size-limit rejection reaches Express as a thrown error, which without this would surface as an unhelpful 500. Modify `backend/src/middleware/errorHandler.ts`:

```ts
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 6: Wire into `backend/src/app.ts`**

```ts
import { keyRouter } from './routes/keyRoutes';
// ...
app.use('/api/servers', serverRouter);
app.use('/api/keys', keyRouter);
// ...
app.use(errorHandler);
```

- [ ] **Step 7: Write the integration test — `backend/tests/keys.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { seed } from '../prisma/seed';
import { hashPassword } from '../src/services/passwordService';

const app = createApp();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';

async function loginAs(email: string, password: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password });
  return agent;
}

async function createTestUser(roleName: string, email: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: roleName,
      passwordHash: await hashPassword('Password123!'),
      roleId: role.id,
    },
  });
}

const FAKE_KEY = Buffer.from(
  '-----BEGIN OPENSSH PRIVATE KEY-----\nnotarealkey\n-----END OPENSSH PRIVATE KEY-----\n',
);

describe('keys', () => {
  let adminAgent: ReturnType<typeof request.agent>;
  let operatorAgent: ReturnType<typeof request.agent>;
  let viewerAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    await seed(prisma);
    await createTestUser('Operator', 'operator@example.com');
    await createTestUser('Viewer', 'viewer@example.com');

    adminAgent = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    operatorAgent = await loginAs('operator@example.com', 'Password123!');
    viewerAgent = await loginAs('viewer@example.com', 'Password123!');
  });

  afterAll(async () => {
    await prisma.server.updateMany({ data: { assignedKeyId: null } });
    await prisma.sSHKey.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['operator@example.com', 'viewer@example.com'] } },
    });
    await prisma.$disconnect();
  });

  it('lets an operator upload a key but never exposes storageRef/iv/authTag', async () => {
    const res = await operatorAgent
      .post('/api/keys')
      .field('name', 'ci-deploy-key')
      .field('keyType', 'ed25519')
      .attach('file', FAKE_KEY, 'id_ed25519');

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('storageRef');
    expect(res.body).not.toHaveProperty('iv');
    expect(res.body).not.toHaveProperty('authTag');
    expect(res.body.name).toBe('ci-deploy-key');
  });

  it('rejects a file that does not look like a private key', async () => {
    const res = await operatorAgent
      .post('/api/keys')
      .field('name', 'not-a-key')
      .field('keyType', 'rsa')
      .attach('file', Buffer.from('just some text'), 'not-a-key.txt');

    expect(res.status).toBe(400);
  });

  it('lets a viewer list and view key metadata but not upload', async () => {
    const listRes = await viewerAgent.get('/api/keys');
    expect(listRes.status).toBe(200);
    expect(listRes.body[0]).not.toHaveProperty('storageRef');

    const uploadRes = await viewerAgent
      .post('/api/keys')
      .field('name', 'viewer-attempt')
      .field('keyType', 'rsa')
      .attach('file', FAKE_KEY, 'id_rsa');
    expect(uploadRes.status).toBe(403);
  });

  it('never lets a viewer download a private key', async () => {
    const list = await adminAgent.get('/api/keys');
    const keyId = list.body.find((k: { name: string }) => k.name === 'ci-deploy-key').id;

    const res = await viewerAgent.get(`/api/keys/${keyId}/download`);
    expect(res.status).toBe(403);
  });

  it('lets an admin download the decrypted key content as a file, not JSON', async () => {
    const list = await adminAgent.get('/api/keys');
    const keyId = list.body.find((k: { name: string }) => k.name === 'ci-deploy-key').id;

    const res = await adminAgent.get(`/api/keys/${keyId}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(Buffer.from(res.body).equals(FAKE_KEY)).toBe(true);
  });

  it('lets an operator assign a key to a server, but admin cannot per this project\'s permission model', async () => {
    const server = await prisma.server.create({
      data: {
        hostname: 'assign-target.internal',
        ipAddress: '10.0.0.9',
        os: 'LINUX',
        environment: 'PRODUCTION',
        application: 'web',
        owner: 'Platform Team',
        username: 'deploy',
        createdById: (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id,
      },
    });
    const list = await adminAgent.get('/api/keys');
    const keyId = list.body.find((k: { name: string }) => k.name === 'ci-deploy-key').id;

    const adminAttempt = await adminAgent.post(`/api/keys/${keyId}/assign`).send({ serverId: server.id });
    expect(adminAttempt.status).toBe(403);

    const operatorAttempt = await operatorAgent
      .post(`/api/keys/${keyId}/assign`)
      .send({ serverId: server.id });
    expect(operatorAttempt.status).toBe(200);
    expect(operatorAttempt.body.assignedKeyId).toBe(keyId);
  });

  it('lets an admin delete a key', async () => {
    const list = await adminAgent.get('/api/keys');
    const key = list.body.find((k: { name: string }) => k.name === 'not-a-key');
    // upload of "not-a-key" was rejected above, so create one fresh to delete
    const created = await adminAgent
      .post('/api/keys')
      .field('name', 'to-delete')
      .field('keyType', 'rsa')
      .attach('file', FAKE_KEY, 'id_rsa');

    const res = await adminAgent.delete(`/api/keys/${created.body.id}`);
    expect(res.status).toBe(204);

    const getRes = await adminAgent.get(`/api/keys/${created.body.id}`);
    expect(getRes.status).toBe(404);
    void key;
  });
});
```

- [ ] **Step 8: Provide a real Postgres, migrate, run the full backend suite**

```bash
docker run -d --name temp-postgres-keys -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine
# wait for pg_isready, then from backend/:
npx prisma migrate deploy
npm test
```

Expected: all suites pass, including `tests/keys.test.ts` and the updated `tests/seed.test.ts`.

- [ ] **Step 9: Lint, typecheck, tear down Postgres**

```bash
npm run lint && npx tsc --noEmit
docker stop temp-postgres-keys && docker rm temp-postgres-keys
```

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/keyService.ts backend/src/controllers/keyController.ts backend/src/routes/keyRoutes.ts backend/src/middleware/errorHandler.ts backend/src/app.ts backend/tests/keys.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(backend): add SSH key upload/download/delete/assign with RBAC"
```

---

### Task 5: Frontend — key types, current-user hook, apiClient FormData fix

**Files:**
- Create: `frontend/types/key.ts`
- Create: `frontend/lib/useCurrentUser.ts`
- Modify: `frontend/lib/apiClient.ts`

**Interfaces:**
- Produces: `SSHKeyMetadata` type, `useCurrentUser()` hook returning `{ data, isLoading }` where `data.permissions: string[]` — Task 6's key list page uses this to conditionally render Download/Delete/Assign actions (UX only; backend re-checks regardless).

- [ ] **Step 1: Fix `apiFetch` to not force JSON headers on `FormData` bodies**

The key upload form (Task 6) posts `multipart/form-data` via `FormData`. The current `apiFetch` (Phase 3) always sets `Content-Type: application/json`, which breaks multipart uploads (the browser needs to set its own `boundary=...` value in the `Content-Type` it generates for `FormData`). Modify `frontend/lib/apiClient.ts`:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isFormData = init.body instanceof FormData;

  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
}
```

- [ ] **Step 2: Create `frontend/types/key.ts`**

```ts
export interface SSHKeyMetadata {
  id: string;
  name: string;
  keyType: string;
  description: string | null;
  owner: { id: string; name: string; email: string };
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedServer: { id: string; hostname: string } | null;
}
```

- [ ] **Step 3: Create `frontend/lib/useCurrentUser.ts`**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './apiClient';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const res = await apiFetch('/api/auth/me');
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    },
    retry: false,
  });
}
```

- [ ] **Step 4: Typecheck and build**

Run (from `frontend/`): `npx tsc --noEmit && npm run build`
Expected: both exit 0

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/apiClient.ts frontend/types/key.ts frontend/lib/useCurrentUser.ts
git commit -m "feat(frontend): add key metadata type, current-user hook, and FormData fix for uploads"
```

---

### Task 6: Key list page and upload page

**Files:**
- Create: `frontend/app/keys/page.tsx`
- Create: `frontend/app/keys/upload/page.tsx`
- Test: `frontend/tests/keys-list.test.tsx`

**Interfaces:**
- Consumes: `SSHKeyMetadata` (Task 5), `useCurrentUser` (Task 5), `Table*`/`AlertDialog*` (Phase 4).

- [ ] **Step 1: Write the failing test — `frontend/tests/keys-list.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import KeysPage from '../app/keys/page';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('KeysPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'u1',
              email: 'viewer@example.com',
              name: 'Viewer',
              role: 'Viewer',
              permissions: ['key:view'],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'k1',
              name: 'prod-web-key',
              keyType: 'ed25519',
              description: null,
              owner: { id: 'u1', name: 'Admin', email: 'admin@example.com' },
              lastAccessedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              assignedServer: null,
            },
          ],
        });
      }),
    );
  });

  it('renders key metadata but hides the download action for a viewer', async () => {
    renderWithClient(<KeysPage />);
    expect(await screen.findByText('prod-web-key')).toBeDefined();
    expect(screen.queryByText('Download')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/keys-list.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create `frontend/app/keys/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/apiClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import type { SSHKeyMetadata } from '@/types/key';

export default function KeysPage() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const permissions = currentUser?.permissions ?? [];

  const { data: keys, isLoading, isError } = useQuery<SSHKeyMetadata[]>({
    queryKey: ['keys', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await apiFetch(`/api/keys?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load keys');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete key');
    },
    onSuccess: () => {
      toast.success('Key deleted');
      queryClient.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: () => toast.error('Failed to delete key'),
  });

  async function handleDownload(key: SSHKeyMetadata) {
    const res = await apiFetch(`/api/keys/${key.id}/download`);
    if (!res.ok) {
      toast.error('Failed to download key');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = key.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">SSH Keys</h1>
        {permissions.includes('key:upload') && (
          <Button asChild>
            <Link href="/keys/upload">Upload Key</Link>
          </Button>
        )}
      </div>

      <Input
        placeholder="Search key name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      {isLoading && <p>Loading keys...</p>}
      {isError && <p className="text-red-600">Failed to load keys.</p>}
      {keys && keys.length === 0 && <p className="text-slate-500">No keys found.</p>}

      {keys && keys.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Assigned Server</TableHead>
              <TableHead>Last Accessed</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell>{key.name}</TableCell>
                <TableCell>{key.keyType}</TableCell>
                <TableCell>{key.owner.name}</TableCell>
                <TableCell>{key.assignedServer?.hostname ?? '—'}</TableCell>
                <TableCell>
                  {key.lastAccessedAt ? new Date(key.lastAccessedAt).toLocaleString() : 'Never'}
                </TableCell>
                <TableCell className="flex gap-2">
                  {permissions.includes('key:download') && (
                    <button
                      className="text-sm text-slate-700 underline"
                      onClick={() => handleDownload(key)}
                    >
                      Download
                    </button>
                  )}
                  {permissions.includes('key:delete') && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="text-sm text-red-600 underline">Delete</button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle>Delete {key.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the encrypted key material. This cannot be undone.
                        </AlertDialogDescription>
                        <AlertDialogFooter>
                          <AlertDialogCancel asChild>
                            <Button variant="outline">Cancel</Button>
                          </AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <Button variant="destructive" onClick={() => deleteMutation.mutate(key.id)}>
                              Delete
                            </Button>
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/keys-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Create `frontend/app/keys/upload/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/apiClient';

export default function UploadKeyPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [keyType, setKeyType] = useState('ed25519');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error('Select a key file');
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.set('name', name);
    formData.set('keyType', keyType);
    formData.set('description', description);
    formData.set('file', file);

    const res = await apiFetch('/api/keys', { method: 'POST', body: formData });
    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to upload key');
      return;
    }

    toast.success('Key uploaded');
    router.push('/keys');
  }

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Upload SSH Key</h1>
      <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
        <div>
          <Label htmlFor="name">Key Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="keyType">Key Type</Label>
          <select
            id="keyType"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={keyType}
            onChange={(e) => setKeyType(e.target.value)}
          >
            <option value="ed25519">ed25519</option>
            <option value="rsa">rsa</option>
            <option value="ecdsa">ecdsa</option>
            <option value="dsa">dsa</option>
          </select>
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="file">Private Key File</Label>
          <input
            id="file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm"
            required
          />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Uploading...' : 'Upload Key'}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Full frontend verification**

Run (from `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 7: Commit**

```bash
git add frontend/app/keys frontend/tests/keys-list.test.tsx
git commit -m "feat(frontend): add SSH key list and upload pages with permission-gated actions"
```

---

## Self-Review Notes

- **Spec coverage:** §8 SSH Key Management (upload, view metadata, assign, download, delete, search) → Tasks 4, 6. §9 Key Download Security's 7-step sequence → `requireAuth` → `requirePermission('key:download')` (routes) → key-exists check (`downloadKey` throws `KeyNotFoundError`) → decrypt → stream; the one step not yet wired is "record an audit event," explicitly deferred to Phase 6 per the spec's own phased order. Never expose private keys except on download, never log key contents, never store plaintext → enforced by the `select`-based exclusion and the storage abstraction never handling plaintext outside `LocalFilesystemStorageProvider`.
- **Type consistency:** `StorageProvider.get(storageRef, iv, authTag)` (Task 2) is the exact signature `keyService.downloadKey` (Task 4) calls. `SSHKeyMetadata` (Task 5) matches `KEY_METADATA_SELECT`'s shape (Task 4) field-for-field.
- **No placeholders:** every step has literal code or literal commands with expected output. The Admin/`key:assign` gap and the new `key:view` permission are both explicitly reasoned about in Global Constraints rather than left as unexplained deviations from the original request.
