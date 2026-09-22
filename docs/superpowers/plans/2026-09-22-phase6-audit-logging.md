# Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A centralized `logAudit()` helper, retrofitted into every route built in Phases 3-5 (login, logout, server CRUD, key upload/download/delete/assign), plus `GET /api/audit-logs` and the `/audit-logs` frontend page. This is Phase 6.

**Architecture:** One `auditService.ts` owns both the write path (`logAudit`) and the read path (`listAuditLogs`) for the `AuditLog` table, so the shape of what gets written and what gets queried never drifts apart. Controllers call `logAudit` directly (no separate audit middleware) since the exact moment to log — and what metadata is relevant — differs per action (e.g. key download must audit *before* decrypting, per the spec's numbered security sequence).

**Tech Stack:** No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-22-server-inventory-platform-design.md](../specs/2026-09-22-server-inventory-platform-design.md) §9 (audit ordering). Original request §14.

## Global Constraints

- `AuditLog.metadata` never contains secrets or key material — only names/types/ids (e.g. `{ hostname: 'web-01' }`, `{ keyName: 'prod-key' }`), enforced by review of every `logAudit` call site in this plan, not by an automatic redaction layer.
- Only successful actions are audited (matching the original request's action list, which names "Login"/"Logout" etc. without a parallel "Login failed" entry) — failed-login brute-force protection is rate limiting (Phase 3), not an audit trail, so this plan does not add failed-attempt logging.
- Key download's audit write happens **before** decryption, matching the spec's 7-step sequence (auth → permission → exists → authorized → **audit** → decrypt → stream) exactly.
- Inventory and User-management audit events (also listed in the original request's action list) are added when those features are built — Phase 7 for inventory; user management doesn't have a dedicated phase in the original request's Development Order despite being a named module, so it gets its own small plan inserted after this one, before Phase 7.

---

## File Structure

```
backend/src/
├── services/auditService.ts          # logAudit + listAuditLogs + requestContext
├── schemas/auditSchemas.ts
├── controllers/auditController.ts
└── routes/auditRoutes.ts
backend/tests/audit.test.ts

frontend/
├── types/auditLog.ts
└── app/audit-logs/page.tsx
```

---

### Task 1: Audit service (write + read)

**Files:**
- Create: `backend/src/services/auditService.ts`
- Create: `backend/src/schemas/auditSchemas.ts`

**Interfaces:**
- Consumes: `prisma` (Phase 3).
- Produces: `AUDIT_ACTIONS` (const map), `AuditAction` type, `requestContext(req)`, `logAudit(input)`, `listAuditLogs(query)`, `ListAuditLogsQuery` type — every controller modified in Tasks 2-4 imports `AUDIT_ACTIONS`, `logAudit`, and `requestContext` by these exact names.

- [ ] **Step 1: Create `backend/src/schemas/auditSchemas.ts`**

```ts
import { z } from 'zod';

export const listAuditLogsQuerySchema = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
```

- [ ] **Step 2: Create `backend/src/services/auditService.ts`**

```ts
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ListAuditLogsQuery } from '../schemas/auditSchemas';

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  SERVER_CREATED: 'SERVER_CREATED',
  SERVER_UPDATED: 'SERVER_UPDATED',
  SERVER_DELETED: 'SERVER_DELETED',
  KEY_UPLOADED: 'KEY_UPLOADED',
  KEY_DOWNLOADED: 'KEY_DOWNLOADED',
  KEY_DELETED: 'KEY_DELETED',
  KEY_ASSIGNED: 'KEY_ASSIGNED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface LogAuditInput {
  userId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export function requestContext(req: Request): { ipAddress: string; userAgent?: string } {
  return {
    ipAddress: req.ip ?? 'unknown',
    userAgent: req.get('user-agent') ?? undefined,
  };
}

export async function logAudit(input: LogAuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? undefined,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? undefined,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function listAuditLogs(query: ListAuditLogsQuery) {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.userId) where.userId = query.userId;

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}
```

- [ ] **Step 3: Typecheck**

Run (from `backend/`): `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/auditService.ts backend/src/schemas/auditSchemas.ts
git commit -m "feat(backend): add audit logging service (write + read)"
```

---

### Task 2: Audit login and logout

**Files:**
- Modify: `backend/src/routes/authRoutes.ts`

**Interfaces:**
- Consumes: `logAudit`, `AUDIT_ACTIONS`, `requestContext` (Task 1); `verifyAccessToken` (Phase 3, for best-effort user identification on logout, which isn't behind `requireAuth`).

- [ ] **Step 1: Add the audit import and log the login route**

In `backend/src/routes/authRoutes.ts`, add the import:

```ts
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';
```

In the `/login` handler, right before `res.status(200).json(...)`, add:

```ts
    await logAudit({
      userId: user.id,
      action: AUDIT_ACTIONS.LOGIN,
      resourceType: 'User',
      resourceId: user.id,
      ...requestContext(req),
    });
```

- [ ] **Step 2: Log the logout route**

Logout isn't behind `requireAuth` (so an already-expired session can still clear its cookies), so identify the user best-effort by decoding the access-token cookie without throwing on failure. Replace the `/logout` handler:

```ts
authRouter.post('/logout', async (req: Request, res: Response) => {
  let userId: string | null = null;
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (token) {
    try {
      userId = verifyAccessToken(token).sub;
    } catch {
      // expired/invalid -- log with unknown user rather than failing logout
    }
  }

  await logAudit({
    userId,
    action: AUDIT_ACTIONS.LOGOUT,
    resourceType: 'User',
    resourceId: userId,
    ...requestContext(req),
  });

  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE);
  res.status(200).json({ success: true });
});
```

This needs `verifyAccessToken` imported from `../services/tokenService` alongside the existing `signAccessToken`/`signRefreshToken` import.

- [ ] **Step 2b: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0 (verification against a real DB happens in Task 5)

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/authRoutes.ts
git commit -m "feat(backend): audit login and logout events"
```

---

### Task 3: Audit server create/update/delete

**Files:**
- Modify: `backend/src/services/serverService.ts`
- Modify: `backend/src/controllers/serverController.ts`

**Interfaces:**
- Consumes: `logAudit`, `AUDIT_ACTIONS`, `requestContext` (Task 1).
- Produces: `deleteServer` now returns the deleted `Server` row instead of `void` — needed so the controller can log the hostname without an extra query. This changes `deleteServer`'s signature from Phase 4; no other caller exists yet.

- [ ] **Step 1: Change `deleteServer` to return the deleted row**

In `backend/src/services/serverService.ts`, change:

```ts
export async function deleteServer(id: string): Promise<void> {
  try {
    await prisma.server.delete({ where: { id } });
  } catch (err) {
```

to:

```ts
export async function deleteServer(id: string) {
  try {
    return await prisma.server.delete({ where: { id } });
  } catch (err) {
```

- [ ] **Step 2: Add audit calls in `backend/src/controllers/serverController.ts`**

Add the import:

```ts
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';
```

In `createServerHandler`, after `const server = await createServer(...)` and before responding:

```ts
    const server = await createServer(parsed.data, req.user!.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.SERVER_CREATED,
      resourceType: 'Server',
      resourceId: server.id,
      metadata: { hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(201).json(server);
```

In `updateServerHandler`:

```ts
    const server = await updateServer(req.params.id, parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.SERVER_UPDATED,
      resourceType: 'Server',
      resourceId: server.id,
      metadata: { hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(200).json(server);
```

In `deleteServerHandler`:

```ts
export async function deleteServerHandler(req: Request, res: Response): Promise<void> {
  try {
    const server = await deleteServer(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.SERVER_DELETED,
      resourceType: 'Server',
      resourceId: server.id,
      metadata: { hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(204).send();
  } catch (err) {
    if (err instanceof ServerNotFoundError) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    throw err;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/serverService.ts backend/src/controllers/serverController.ts
git commit -m "feat(backend): audit server create/update/delete"
```

---

### Task 4: Audit key upload/download/delete/assign

**Files:**
- Modify: `backend/src/services/keyService.ts`
- Modify: `backend/src/controllers/keyController.ts`

**Interfaces:**
- Consumes: `logAudit`, `AUDIT_ACTIONS`, `requestContext` (Task 1).
- Produces: `downloadKey` is split into `getKeyForDownload(id)` (fetch + existence check, returns the full row including `storageRef`/`iv`/`authTag` — **internal use only, the controller must never serialize this to a response**) and `decryptAndRecordAccess(key)` (decrypts + bumps `lastAccessedAt`), so the controller can log the audit event *between* those two steps, matching the spec's exact ordering. `deleteKey` now returns the deleted key's metadata instead of `void`, for the same reason `serverService.deleteServer` does in Task 3.

- [ ] **Step 1: Split `downloadKey` in `backend/src/services/keyService.ts`**

Replace the single `downloadKey` function with:

```ts
export async function getKeyForDownload(id: string) {
  const key = await prisma.sSHKey.findUnique({ where: { id } });
  if (!key) throw new KeyNotFoundError();
  return key;
}

export async function decryptAndRecordAccess(key: {
  id: string;
  storageRef: string;
  iv: string;
  authTag: string;
}): Promise<Buffer> {
  const content = await storage.get(key.storageRef, key.iv, key.authTag);
  await prisma.sSHKey.update({ where: { id: key.id }, data: { lastAccessedAt: new Date() } });
  return content;
}
```

- [ ] **Step 2: Make `deleteKey` return the deleted key**

Change:

```ts
export async function deleteKey(id: string): Promise<void> {
  const key = await prisma.sSHKey.findUnique({ where: { id } });
  if (!key) throw new KeyNotFoundError();
  await prisma.sSHKey.delete({ where: { id } });
  await storage.delete(key.storageRef).catch(() => undefined);
}
```

to:

```ts
export async function deleteKey(id: string) {
  const key = await prisma.sSHKey.findUnique({ where: { id } });
  if (!key) throw new KeyNotFoundError();
  await prisma.sSHKey.delete({ where: { id } });
  await storage.delete(key.storageRef).catch(() => undefined);
  return key;
}
```

- [ ] **Step 3: Update `backend/src/controllers/keyController.ts`**

Add the import:

```ts
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';
```

Update the imports from `../services/keyService` to use the new function names (`getKeyForDownload`, `decryptAndRecordAccess` in place of `downloadKey`).

In `uploadKeyHandler`, after creating the key:

```ts
    const key = await uploadKey({ ... });
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_UPLOADED,
      resourceType: 'SSHKey',
      resourceId: key.id,
      metadata: { keyName: key.name, keyType: key.keyType },
      ...requestContext(req),
    });
    res.status(201).json(key);
```

Replace `downloadKeyHandler` entirely:

```ts
export async function downloadKeyHandler(req: Request, res: Response): Promise<void> {
  try {
    const key = await getKeyForDownload(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_DOWNLOADED,
      resourceType: 'SSHKey',
      resourceId: key.id,
      metadata: { keyName: key.name },
      ...requestContext(req),
    });
    const content = await decryptAndRecordAccess(key);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${key.name}"`);
    res.status(200).send(content);
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}
```

Update `deleteKeyHandler`:

```ts
export async function deleteKeyHandler(req: Request, res: Response): Promise<void> {
  try {
    const key = await deleteKey(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_DELETED,
      resourceType: 'SSHKey',
      resourceId: key.id,
      metadata: { keyName: key.name },
      ...requestContext(req),
    });
    res.status(204).send();
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}
```

Update `assignKeyHandler`:

```ts
export async function assignKeyHandler(req: Request, res: Response): Promise<void> {
  const parsed = assignKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const server = await assignKeyToServer(req.params.id, parsed.data.serverId);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_ASSIGNED,
      resourceType: 'SSHKey',
      resourceId: req.params.id,
      metadata: { serverId: server.id, hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(200).json(server);
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/keyService.ts backend/src/controllers/keyController.ts
git commit -m "feat(backend): audit key upload/download/delete/assign"
```

---

### Task 5: Audit log list endpoint + integration test

**Files:**
- Create: `backend/src/controllers/auditController.ts`
- Create: `backend/src/routes/auditRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/audit.test.ts`

**Interfaces:**
- Consumes: `listAuditLogsQuerySchema` (Task 1), `listAuditLogs` (Task 1), `requireAuth`/`requirePermission` (Phase 3).
- Produces: `auditRouter` mounted at `/api/audit-logs`.

- [ ] **Step 1: Create `backend/src/controllers/auditController.ts`**

```ts
import { Request, Response } from 'express';
import { listAuditLogsQuerySchema } from '../schemas/auditSchemas';
import { listAuditLogs } from '../services/auditService';

export async function listAuditLogsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await listAuditLogs(parsed.data));
}
```

- [ ] **Step 2: Create `backend/src/routes/auditRoutes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { listAuditLogsHandler } from '../controllers/auditController';

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.get('/', requirePermission('audit:view'), listAuditLogsHandler);
```

- [ ] **Step 3: Wire into `backend/src/app.ts`**

```ts
import { auditRouter } from './routes/auditRoutes';
// ...
app.use('/api/keys', keyRouter);
app.use('/api/audit-logs', auditRouter);
// ...
app.use(errorHandler);
```

- [ ] **Step 4: Write the integration test — `backend/tests/audit.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { seed } from '../prisma/seed';

const app = createApp();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';

const FAKE_KEY = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n');

describe('audit logging', () => {
  let adminAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    await seed(prisma);
    adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  });

  afterAll(async () => {
    await prisma.server.deleteMany({ where: { hostname: 'audit-test-01.internal' } });
    await prisma.sSHKey.deleteMany({ where: { name: 'audit-test-key' } });
    await prisma.$disconnect();
  });

  it('records a LOGIN audit entry on successful login', async () => {
    const logs = await adminAgent.get('/api/audit-logs').query({ action: 'LOGIN' });
    expect(logs.status).toBe(200);
    expect(logs.body.data.length).toBeGreaterThan(0);
    expect(logs.body.data[0].action).toBe('LOGIN');
    expect(logs.body.data[0].user.email).toBe(ADMIN_EMAIL);
  });

  it('records SERVER_CREATED and SERVER_DELETED audit entries with hostname metadata but no secrets', async () => {
    const createRes = await adminAgent.post('/api/servers').send({
      hostname: 'audit-test-01.internal',
      ipAddress: '10.0.0.50',
      os: 'LINUX',
      environment: 'TEST',
      application: 'audit-check',
      owner: 'QA',
      username: 'deploy',
    });
    const serverId = createRes.body.id;

    await adminAgent.delete(`/api/servers/${serverId}`);

    const createdLogs = await adminAgent.get('/api/audit-logs').query({ action: 'SERVER_CREATED' });
    const entry = createdLogs.body.data.find((l: { resourceId: string }) => l.resourceId === serverId);
    expect(entry.metadata).toEqual({ hostname: 'audit-test-01.internal' });

    const deletedLogs = await adminAgent.get('/api/audit-logs').query({ action: 'SERVER_DELETED' });
    expect(deletedLogs.body.data.some((l: { resourceId: string }) => l.resourceId === serverId)).toBe(true);
  });

  it('records a KEY_DOWNLOADED audit entry without leaking key content in metadata', async () => {
    const uploadRes = await adminAgent
      .post('/api/keys')
      .field('name', 'audit-test-key')
      .field('keyType', 'ed25519')
      .attach('file', FAKE_KEY, 'id_ed25519');
    const keyId = uploadRes.body.id;

    await adminAgent.get(`/api/keys/${keyId}/download`);

    const logs = await adminAgent.get('/api/audit-logs').query({ action: 'KEY_DOWNLOADED' });
    const entry = logs.body.data.find((l: { resourceId: string }) => l.resourceId === keyId);
    expect(entry).toBeDefined();
    expect(entry.metadata).toEqual({ keyName: 'audit-test-key' });
    expect(JSON.stringify(entry.metadata)).not.toContain('BEGIN OPENSSH');
  });

  it('supports pagination', async () => {
    const res = await adminAgent.get('/api/audit-logs').query({ page: 1, pageSize: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(2);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 5: Provide a real Postgres, migrate, run the full backend suite**

```bash
docker run -d --name temp-postgres-audit -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine
# wait for pg_isready, then from backend/:
npx prisma migrate deploy
npm test
```

Expected: all suites pass, including `tests/audit.test.ts`, and the previously-passing `tests/servers.test.ts`/`tests/keys.test.ts`/`tests/auth.test.ts` still pass unchanged (this task only adds side-effect audit writes, it doesn't change any existing response shape).

- [ ] **Step 6: Lint, typecheck, tear down Postgres**

```bash
npm run lint && npx tsc --noEmit
docker stop temp-postgres-audit && docker rm temp-postgres-audit
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/auditController.ts backend/src/routes/auditRoutes.ts backend/src/app.ts backend/tests/audit.test.ts
git commit -m "feat(backend): add audit log list endpoint with tests"
```

---

### Task 6: Audit logs frontend page

**Files:**
- Create: `frontend/types/auditLog.ts`
- Create: `frontend/app/audit-logs/page.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `Table*` (Phase 3-4).

- [ ] **Step 1: Create `frontend/types/auditLog.ts`**

```ts
export interface AuditLogEntry {
  id: string;
  user: { id: string; name: string; email: string } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface PaginatedAuditLogs {
  data: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Create `frontend/app/audit-logs/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { apiFetch } from '@/lib/apiClient';
import type { PaginatedAuditLogs } from '@/types/auditLog';

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery<PaginatedAuditLogs>({
    queryKey: ['audit-logs', { action, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (action) params.set('action', action);
      const res = await apiFetch(`/api/audit-logs?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load audit logs');
      return res.json();
    },
  });

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Audit Logs</h1>

      <Input
        placeholder="Filter by action (e.g. SERVER_CREATED)"
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-sm"
      />

      {isLoading && <p>Loading audit logs...</p>}
      {isError && <p className="text-red-600">Failed to load audit logs.</p>}
      {data && data.data.length === 0 && <p className="text-slate-500">No audit entries found.</p>}

      {data && data.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>IP Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                <TableCell>{entry.user?.email ?? 'Unknown'}</TableCell>
                <TableCell>{entry.action}</TableCell>
                <TableCell>
                  {entry.resourceType}
                  {entry.metadata && Object.keys(entry.metadata).length > 0
                    ? ` (${Object.values(entry.metadata).join(', ')})`
                    : ''}
                </TableCell>
                <TableCell>{entry.ipAddress ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data && data.total > pageSize && (
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-slate-500">
            Page {data.page} of {Math.ceil(data.total / data.pageSize)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Full frontend verification**

Run (from `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 4: Commit**

```bash
git add frontend/types/auditLog.ts frontend/app/audit-logs
git commit -m "feat(frontend): add audit logs page"
```

---

## Self-Review Notes

- **Spec coverage:** §14's audit action list → login/logout (Task 2), server CRUD (Task 3), key upload/download/delete/assign (Task 4) — inventory and user-management events deferred to their own not-yet-scheduled phases, per Global Constraints. "Never store secrets or private key contents in audit metadata" → verified by `tests/audit.test.ts`'s explicit `not.toContain('BEGIN OPENSSH')` assertion. §9's audit-before-decrypt ordering → Task 4's `getKeyForDownload`/`decryptAndRecordAccess` split.
- **Type consistency:** `AuditAction` (Task 1) is a closed union from `AUDIT_ACTIONS`, so every `logAudit` call site in Tasks 2-4 is checked against it at compile time — a typo'd action string fails `tsc`, not silently logs the wrong value. `AuditLogEntry` (Task 6) matches `listAuditLogs`'s Prisma `include` shape (Task 1) field-for-field.
- **No placeholders:** every step has literal code or literal commands with expected output.
