# Server Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full server CRUD — REST API with search/filter/sort/pagination and RBAC enforcement, plus the `/servers`, `/servers/new`, `/servers/[id]`, `/servers/[id]/edit` frontend pages. This is Phase 4.

**Architecture:** Backend adds a real Controller layer for the first time (Routes → Controllers → Services → Prisma) since server CRUD has enough branching (validation errors, 404, 409 duplicate hostname, RBAC per verb) to earn it, unlike Phase 3's three simple auth endpoints. Frontend adds TanStack Query for server data fetching/caching, `sonner` for toasts, and a Radix-based `AlertDialog` for delete confirmation — both thin, single-purpose libraries rather than hand-rolled equivalents.

**Tech Stack:** `@tanstack/react-query` (already installed, unused until now), `sonner`, `@radix-ui/react-alert-dialog` (new).

**Spec:** [docs/superpowers/specs/2026-09-22-server-inventory-platform-design.md](../specs/2026-09-22-server-inventory-platform-design.md) — see original request §5-7 (Server Inventory, Add Server, Server Details).

## Global Constraints

- Backend enforces RBAC on every route via `requirePermission` (Phase 3) — the frontend never hides a button as its only protection.
- Zod validates every request body and query string.
- SSH key assignment fields (`assignedKey`) exist on the `Server` model already (Phase 2) but aren't wired up until Phase 5 — Server Details shows "None" for the assigned key until then.
- No audit logging yet — Phase 6 adds `AuditLog` writes to the routes this plan creates.

---

## File Structure

```
backend/src/
├── schemas/serverSchemas.ts
├── services/serverService.ts
├── controllers/serverController.ts
└── routes/serverRoutes.ts
backend/tests/servers.test.ts

frontend/
├── app/providers.tsx                 # TanStack QueryClientProvider (client component)
├── types/server.ts
├── components/ui/{input,table,label,alert-dialog}.tsx
├── components/servers/ServerForm.tsx
├── app/servers/page.tsx
├── app/servers/new/page.tsx
├── app/servers/[id]/page.tsx
└── app/servers/[id]/edit/page.tsx
frontend/tests/{servers-list,server-form}.test.tsx
```

---

### Task 1: Fix Admin's missing `server:view` permission

Phase 1's seed gave Admin `server:create`/`edit`/`delete` but not `server:view`, on the assumption that "Admin's edit/delete checks don't require a separate view permission" — that assumption breaks now that this plan puts `requirePermission('server:view')` on the `GET` routes. Without this fix, Admin gets 403 listing servers.

**Files:**
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/tests/seed.test.ts`

- [ ] **Step 1: Add `server:view` to Admin's permission list**

In `backend/prisma/seed.ts`, `ROLE_PERMISSIONS.Admin` currently reads:

```ts
  Admin: [
    'user:manage',
    'role:manage',
    'server:create',
    'server:edit',
    'server:delete',
    'key:upload',
    'key:download',
    'key:delete',
    'inventory:create',
    'inventory:manage',
    'audit:view',
  ],
```

Add `'server:view'` to that array (12 entries total).

- [ ] **Step 2: Update the expected count in `backend/tests/seed.test.ts`**

Change `expect(admin?.permissions.length).toBe(11);` to `expect(admin?.permissions.length).toBe(12);`.

- [ ] **Step 3: Run test to verify it passes** (needs a real Postgres — see Task 4's verification step for how to provide one; if you already have one running from a prior task, reuse it)

Run (from `backend/`): `npx jest tests/seed.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts backend/tests/seed.test.ts
git commit -m "fix(backend): give Admin the server:view permission"
```

---

### Task 2: Zod schemas for Server

**Files:**
- Create: `backend/src/schemas/serverSchemas.ts`

**Interfaces:**
- Produces: `createServerSchema`, `updateServerSchema`, `listServersQuerySchema`, `CreateServerInput`, `UpdateServerInput`, `ListServersQuery` — Task 3's service and Task 4's controller both import these exact names.

- [ ] **Step 1: Implement**

```ts
import { z } from 'zod';

export const operatingSystemEnum = z.enum(['LINUX', 'WINDOWS', 'OTHER']);
export const environmentEnum = z.enum(['PRODUCTION', 'UAT', 'DEVELOPMENT', 'TEST']);
export const serverStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'DECOMMISSIONED']);

export const createServerSchema = z.object({
  hostname: z.string().min(1).max(255),
  ipAddress: z.string().min(1).max(45),
  os: operatingSystemEnum,
  environment: environmentEnum,
  application: z.string().min(1).max(255),
  owner: z.string().min(1).max(255),
  location: z.string().max(255).optional(),
  username: z.string().min(1).max(100),
  sshPort: z.coerce.number().int().min(1).max(65535).default(22),
  description: z.string().max(2000).optional(),
});

export const updateServerSchema = createServerSchema.partial().extend({
  status: serverStatusEnum.optional(),
});

export const listServersQuerySchema = z.object({
  search: z.string().optional(),
  os: operatingSystemEnum.optional(),
  environment: environmentEnum.optional(),
  status: serverStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['hostname', 'createdAt', 'environment', 'os']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateServerInput = z.infer<typeof createServerSchema>;
export type UpdateServerInput = z.infer<typeof updateServerSchema>;
export type ListServersQuery = z.infer<typeof listServersQuerySchema>;
```

- [ ] **Step 2: Typecheck**

Run (from `backend/`): `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/serverSchemas.ts
git commit -m "feat(backend): add Zod schemas for server CRUD"
```

---

### Task 3: Server service (Prisma-backed CRUD + list)

**Files:**
- Create: `backend/src/services/serverService.ts`

**Interfaces:**
- Consumes: `prisma` (Phase 3), `CreateServerInput`/`UpdateServerInput`/`ListServersQuery` (Task 2).
- Produces: `PaginatedResult<T>`, `ServerNotFoundError`, `DuplicateHostnameError`, `listServers`, `getServerById`, `createServer`, `updateServer`, `deleteServer` — Task 4's controller imports these exact names.

- [ ] **Step 1: Implement**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { CreateServerInput, UpdateServerInput, ListServersQuery } from '../schemas/serverSchemas';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export class ServerNotFoundError extends Error {}
export class DuplicateHostnameError extends Error {}

const SERVER_INCLUDE = { assignedKey: true, createdBy: true } as const;

export async function listServers(
  query: ListServersQuery,
): Promise<PaginatedResult<Prisma.ServerGetPayload<{ include: typeof SERVER_INCLUDE }>>> {
  const where: Prisma.ServerWhereInput = {};

  if (query.search) {
    where.OR = [
      { hostname: { contains: query.search, mode: 'insensitive' } },
      { ipAddress: { contains: query.search, mode: 'insensitive' } },
      { application: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.os) where.os = query.os;
  if (query.environment) where.environment = query.environment;
  if (query.status) where.status = query.status;

  const orderBy: Prisma.ServerOrderByWithRelationInput = { [query.sortBy]: query.sortOrder };

  const [data, total] = await Promise.all([
    prisma.server.findMany({
      where,
      include: SERVER_INCLUDE,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.server.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}

export async function getServerById(id: string) {
  return prisma.server.findUnique({ where: { id }, include: SERVER_INCLUDE });
}

export async function createServer(input: CreateServerInput, createdById: string) {
  try {
    return await prisma.server.create({ data: { ...input, createdById } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateHostnameError();
    }
    throw err;
  }
}

export async function updateServer(id: string, input: UpdateServerInput) {
  try {
    return await prisma.server.update({ where: { id }, data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new ServerNotFoundError();
      if (err.code === 'P2002') throw new DuplicateHostnameError();
    }
    throw err;
  }
}

export async function deleteServer(id: string): Promise<void> {
  try {
    await prisma.server.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new ServerNotFoundError();
    }
    throw err;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0. If `orderBy: { [query.sortBy]: query.sortOrder }` fails to typecheck against `Prisma.ServerOrderByWithRelationInput`, replace it with an explicit switch over `query.sortBy` building the same object — the dynamic-key form is expected to work because `sortBy`'s Zod enum only contains valid scalar column names, but Prisma's generated types can be strict about computed keys depending on version.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/serverService.ts
git commit -m "feat(backend): add server CRUD service with search/filter/sort/pagination"
```

---

### Task 4: Server controller, routes, and integration tests

**Files:**
- Create: `backend/src/controllers/serverController.ts`
- Create: `backend/src/routes/serverRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/servers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-3; `requireAuth`/`requirePermission` (Phase 3).
- Produces: `serverRouter` mounted at `/api/servers`.

- [ ] **Step 1: Create `backend/src/controllers/serverController.ts`**

```ts
import { Request, Response } from 'express';
import {
  createServerSchema,
  updateServerSchema,
  listServersQuerySchema,
} from '../schemas/serverSchemas';
import {
  listServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  ServerNotFoundError,
  DuplicateHostnameError,
} from '../services/serverService';

export async function listServersHandler(req: Request, res: Response): Promise<void> {
  const parsed = listServersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await listServers(parsed.data));
}

export async function getServerHandler(req: Request, res: Response): Promise<void> {
  const server = await getServerById(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  res.status(200).json(server);
}

export async function createServerHandler(req: Request, res: Response): Promise<void> {
  const parsed = createServerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    res.status(201).json(await createServer(parsed.data, req.user!.id));
  } catch (err) {
    if (err instanceof DuplicateHostnameError) {
      res.status(409).json({ error: 'A server with this hostname already exists' });
      return;
    }
    throw err;
  }
}

export async function updateServerHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateServerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(await updateServer(req.params.id, parsed.data));
  } catch (err) {
    if (err instanceof ServerNotFoundError) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    if (err instanceof DuplicateHostnameError) {
      res.status(409).json({ error: 'A server with this hostname already exists' });
      return;
    }
    throw err;
  }
}

export async function deleteServerHandler(req: Request, res: Response): Promise<void> {
  try {
    await deleteServer(req.params.id);
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

- [ ] **Step 2: Create `backend/src/routes/serverRoutes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listServersHandler,
  getServerHandler,
  createServerHandler,
  updateServerHandler,
  deleteServerHandler,
} from '../controllers/serverController';

export const serverRouter = Router();

serverRouter.use(requireAuth);

serverRouter.get('/', requirePermission('server:view'), listServersHandler);
serverRouter.post('/', requirePermission('server:create'), createServerHandler);
serverRouter.get('/:id', requirePermission('server:view'), getServerHandler);
serverRouter.put('/:id', requirePermission('server:edit'), updateServerHandler);
serverRouter.delete('/:id', requirePermission('server:delete'), deleteServerHandler);
```

- [ ] **Step 3: Wire into `backend/src/app.ts`**

Add the import and mount line (keep everything else from Phase 3 as-is):

```ts
import { serverRouter } from './routes/serverRoutes';
// ...
app.use('/api/auth', authRouter);
app.use('/api/servers', serverRouter);
// ...
app.use(errorHandler);
```

- [ ] **Step 4: Write the integration test — `backend/tests/servers.test.ts`**

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

const baseServerInput = {
  hostname: 'web-01.internal',
  ipAddress: '10.0.0.1',
  os: 'LINUX',
  environment: 'PRODUCTION',
  application: 'web',
  owner: 'Platform Team',
  username: 'deploy',
  sshPort: 22,
};

describe('servers', () => {
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
    await prisma.server.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['operator@example.com', 'viewer@example.com'] } },
    });
    await prisma.$disconnect();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/servers');
    expect(res.status).toBe(401);
  });

  it('lets a viewer list servers but not create one', async () => {
    const listRes = await viewerAgent.get('/api/servers');
    expect(listRes.status).toBe(200);

    const createRes = await viewerAgent.post('/api/servers').send(baseServerInput);
    expect(createRes.status).toBe(403);
  });

  it('lets an operator create and edit a server but not delete it', async () => {
    const createRes = await operatorAgent.post('/api/servers').send(baseServerInput);
    expect(createRes.status).toBe(201);
    const serverId = createRes.body.id;

    const editRes = await operatorAgent
      .put(`/api/servers/${serverId}`)
      .send({ description: 'updated' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.description).toBe('updated');

    const deleteRes = await operatorAgent.delete(`/api/servers/${serverId}`);
    expect(deleteRes.status).toBe(403);
  });

  it('lets an admin do full CRUD, including delete', async () => {
    const createRes = await adminAgent
      .post('/api/servers')
      .send({ ...baseServerInput, hostname: 'admin-crud-01.internal' });
    expect(createRes.status).toBe(201);
    const serverId = createRes.body.id;

    const getRes = await adminAgent.get(`/api/servers/${serverId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.hostname).toBe('admin-crud-01.internal');

    const deleteRes = await adminAgent.delete(`/api/servers/${serverId}`);
    expect(deleteRes.status).toBe(204);

    const getAfterDeleteRes = await adminAgent.get(`/api/servers/${serverId}`);
    expect(getAfterDeleteRes.status).toBe(404);
  });

  it('rejects a duplicate hostname', async () => {
    await adminAgent.post('/api/servers').send({ ...baseServerInput, hostname: 'dup-01.internal' });
    const dupRes = await adminAgent
      .post('/api/servers')
      .send({ ...baseServerInput, hostname: 'dup-01.internal' });
    expect(dupRes.status).toBe(409);
  });

  it('rejects invalid input', async () => {
    const res = await adminAgent.post('/api/servers').send({ hostname: '' });
    expect(res.status).toBe(400);
  });

  it('supports search, filter, sort, and pagination', async () => {
    const res = await adminAgent.get('/api/servers').query({
      search: 'web',
      environment: 'PRODUCTION',
      page: 1,
      pageSize: 5,
      sortBy: 'hostname',
      sortOrder: 'asc',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(5);
  });
});
```

- [ ] **Step 5: Provide a real Postgres, migrate, and run the full backend suite**

```bash
docker run -d --name temp-postgres-servers -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine
# wait for pg_isready, then from backend/:
npx prisma migrate deploy
npm test
```

Expected: all suites pass, including `tests/servers.test.ts` and the updated `tests/seed.test.ts` from Task 1.

- [ ] **Step 6: Lint and typecheck, then tear down Postgres**

```bash
npm run lint && npx tsc --noEmit
docker stop temp-postgres-servers && docker rm temp-postgres-servers
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/serverController.ts backend/src/routes/serverRoutes.ts backend/src/app.ts backend/tests/servers.test.ts
git commit -m "feat(backend): add server CRUD routes with RBAC and integration tests"
```

---

### Task 5: Frontend infra — TanStack Query, toasts, alert dialog, table/input/label primitives

**Files:**
- Create: `frontend/app/providers.tsx`
- Modify: `frontend/app/layout.tsx`
- Create: `frontend/components/ui/input.tsx`
- Create: `frontend/components/ui/label.tsx`
- Create: `frontend/components/ui/table.tsx`
- Create: `frontend/components/ui/alert-dialog.tsx`

**Interfaces:**
- Produces: `<Providers>` wrapping the app (TanStack Query + `<Toaster />`), and `Input`/`Label`/`Table*`/`AlertDialog*` primitives every later page (servers, and Phase 5-7's keys/inventory/users pages) reuses.

- [ ] **Step 1: Install new dependencies**

Run (from `frontend/`): `npm install sonner @radix-ui/react-alert-dialog`

- [ ] **Step 2: Create `frontend/app/providers.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Wire `Providers` into `frontend/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Server Inventory Platform',
  description: 'Internal server inventory and key management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Create `frontend/components/ui/input.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

- [ ] **Step 5: Create `frontend/components/ui/label.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-slate-700', className)} {...props} />;
}
```

- [ ] **Step 6: Create `frontend/components/ui/table.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="border-b border-slate-200" {...props} />;
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-slate-100 hover:bg-slate-50', className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('h-10 px-3 text-left align-middle font-medium text-slate-500', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('p-3 align-middle', className)} {...props} />;
}
```

- [ ] **Step 7: Create `frontend/components/ui/alert-dialog.tsx`**

```tsx
'use client';

import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 bg-black/40" />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export const AlertDialogTitle = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />
);

export const AlertDialogDescription = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    className={cn('mt-2 text-sm text-slate-500', className)}
    {...props}
  />
);

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4 flex justify-end gap-2', className)} {...props} />;
}

export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;
```

- [ ] **Step 8: Typecheck and build**

Run (from `frontend/`): `npx tsc --noEmit && npm run build`
Expected: both exit 0

- [ ] **Step 9: Commit**

```bash
git add frontend/app/providers.tsx frontend/app/layout.tsx frontend/components/ui/input.tsx frontend/components/ui/label.tsx frontend/components/ui/table.tsx frontend/components/ui/alert-dialog.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add TanStack Query provider, toasts, and table/input/dialog primitives"
```

---

### Task 6: Server form component + Add Server page

**Files:**
- Create: `frontend/types/server.ts`
- Create: `frontend/components/servers/ServerForm.tsx`
- Create: `frontend/app/servers/new/page.tsx`
- Test: `frontend/tests/server-form.test.tsx`

**Interfaces:**
- Produces: `Server` type, `ServerFormValues`, `serverFormSchema`, `<ServerForm onSubmit defaultValues? submitLabel? />` — Task 8's edit page reuses this exact component.

- [ ] **Step 1: Create `frontend/types/server.ts`**

```ts
export type OperatingSystem = 'LINUX' | 'WINDOWS' | 'OTHER';
export type Environment = 'PRODUCTION' | 'UAT' | 'DEVELOPMENT' | 'TEST';
export type ServerStatus = 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED';

export interface Server {
  id: string;
  hostname: string;
  ipAddress: string;
  os: OperatingSystem;
  environment: Environment;
  application: string;
  owner: string;
  location: string | null;
  username: string;
  sshPort: number;
  description: string | null;
  status: ServerStatus;
  assignedKey: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedServers {
  data: Server[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Write the failing test — `frontend/tests/server-form.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServerForm } from '../components/servers/ServerForm';

describe('ServerForm', () => {
  it('shows validation errors when required fields are missing', async () => {
    const onSubmit = vi.fn();
    render(<ServerForm onSubmit={onSubmit} submitLabel="Create" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Hostname is required')).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid values', async () => {
    const onSubmit = vi.fn();
    render(<ServerForm onSubmit={onSubmit} submitLabel="Create" />);

    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'web-01' } });
    fireEvent.change(screen.getByLabelText('IP Address'), { target: { value: '10.0.0.1' } });
    fireEvent.change(screen.getByLabelText('Application'), { target: { value: 'web' } });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Platform Team' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'deploy' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      hostname: 'web-01',
      ipAddress: '10.0.0.1',
      application: 'web',
      owner: 'Platform Team',
      username: 'deploy',
      os: 'LINUX',
      environment: 'PRODUCTION',
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/server-form.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Create `frontend/components/servers/ServerForm.tsx`**

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const serverFormSchema = z.object({
  hostname: z.string().min(1, 'Hostname is required'),
  ipAddress: z.string().min(1, 'IP address is required'),
  os: z.enum(['LINUX', 'WINDOWS', 'OTHER']),
  environment: z.enum(['PRODUCTION', 'UAT', 'DEVELOPMENT', 'TEST']),
  application: z.string().min(1, 'Application is required'),
  owner: z.string().min(1, 'Owner is required'),
  location: z.string().optional(),
  username: z.string().min(1, 'Username is required'),
  sshPort: z.coerce.number().int().min(1).max(65535),
  description: z.string().optional(),
});

export type ServerFormValues = z.infer<typeof serverFormSchema>;

interface ServerFormProps {
  defaultValues?: Partial<ServerFormValues>;
  onSubmit: (values: ServerFormValues) => void;
  submitLabel: string;
}

export function ServerForm({ defaultValues, onSubmit, submitLabel }: ServerFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServerFormValues>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: {
      os: 'LINUX',
      environment: 'PRODUCTION',
      sshPort: 22,
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-xl flex-col gap-4">
      <div>
        <Label htmlFor="hostname">Hostname</Label>
        <Input id="hostname" {...register('hostname')} />
        {errors.hostname && <p className="text-sm text-red-600">{errors.hostname.message}</p>}
      </div>
      <div>
        <Label htmlFor="ipAddress">IP Address</Label>
        <Input id="ipAddress" {...register('ipAddress')} />
        {errors.ipAddress && <p className="text-sm text-red-600">{errors.ipAddress.message}</p>}
      </div>
      <div>
        <Label htmlFor="os">Operating System</Label>
        <select
          id="os"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          {...register('os')}
        >
          <option value="LINUX">Linux</option>
          <option value="WINDOWS">Windows</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div>
        <Label htmlFor="environment">Environment</Label>
        <select
          id="environment"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          {...register('environment')}
        >
          <option value="PRODUCTION">Production</option>
          <option value="UAT">UAT</option>
          <option value="DEVELOPMENT">Development</option>
          <option value="TEST">Test</option>
        </select>
      </div>
      <div>
        <Label htmlFor="application">Application</Label>
        <Input id="application" {...register('application')} />
        {errors.application && <p className="text-sm text-red-600">{errors.application.message}</p>}
      </div>
      <div>
        <Label htmlFor="owner">Owner</Label>
        <Input id="owner" {...register('owner')} />
        {errors.owner && <p className="text-sm text-red-600">{errors.owner.message}</p>}
      </div>
      <div>
        <Label htmlFor="location">Location</Label>
        <Input id="location" {...register('location')} />
      </div>
      <div>
        <Label htmlFor="username">Username</Label>
        <Input id="username" {...register('username')} />
        {errors.username && <p className="text-sm text-red-600">{errors.username.message}</p>}
      </div>
      <div>
        <Label htmlFor="sshPort">SSH Port</Label>
        <Input id="sshPort" type="number" {...register('sshPort')} />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          {...register('description')}
        />
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server-form.test.tsx`
Expected: PASS — 2 passed

- [ ] **Step 6: Create `frontend/app/servers/new/page.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ServerForm, ServerFormValues } from '@/components/servers/ServerForm';
import { apiFetch } from '@/lib/apiClient';

export default function NewServerPage() {
  const router = useRouter();

  async function handleSubmit(values: ServerFormValues) {
    const res = await apiFetch('/api/servers', {
      method: 'POST',
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to create server');
      return;
    }

    const server = await res.json();
    toast.success('Server created');
    router.push(`/servers/${server.id}`);
  }

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Add Server</h1>
      <ServerForm onSubmit={handleSubmit} submitLabel="Create Server" />
    </main>
  );
}
```

- [ ] **Step 7: Typecheck, lint, build**

Run (from `frontend/`): `npx tsc --noEmit && npm run lint && npm run build`
Expected: all exit 0

- [ ] **Step 8: Commit**

```bash
git add frontend/types/server.ts frontend/components/servers/ServerForm.tsx frontend/app/servers/new frontend/tests/server-form.test.tsx
git commit -m "feat(frontend): add server form component and Add Server page"
```

---

### Task 7: Server list page (search, filter, sort, pagination, delete)

**Files:**
- Create: `frontend/app/servers/page.tsx`
- Test: `frontend/tests/servers-list.test.tsx`

**Interfaces:**
- Consumes: `Server`/`PaginatedServers` (Task 6), `apiFetch` (Phase 3), `Table*`/`AlertDialog*` (Task 5).

- [ ] **Step 1: Write the failing test — `frontend/tests/servers-list.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ServersPage from '../app/servers/page';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ServersPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: '1',
              hostname: 'web-01',
              ipAddress: '10.0.0.1',
              os: 'LINUX',
              environment: 'PRODUCTION',
              application: 'web',
              owner: 'Platform Team',
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      }),
    );
  });

  it('renders servers returned from the API', async () => {
    renderWithClient(<ServersPage />);
    expect(await screen.findByText('web-01')).toBeDefined();
    expect(screen.getByText('10.0.0.1')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/servers-list.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create `frontend/app/servers/page.tsx`**

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
import type { PaginatedServers } from '@/types/server';

export default function ServersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<PaginatedServers>({
    queryKey: ['servers', { search, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const res = await apiFetch(`/api/servers?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load servers');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/servers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete server');
    },
    onSuccess: () => {
      toast.success('Server deleted');
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: () => toast.error('Failed to delete server'),
  });

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Servers</h1>
        <Button asChild>
          <Link href="/servers/new">Add Server</Link>
        </Button>
      </div>

      <Input
        placeholder="Search hostname, IP, or application"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-sm"
      />

      {isLoading && <p>Loading servers...</p>}
      {isError && <p className="text-red-600">Failed to load servers.</p>}
      {data && data.data.length === 0 && <p className="text-slate-500">No servers found.</p>}

      {data && data.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hostname</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>OS</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Application</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((server) => (
              <TableRow key={server.id}>
                <TableCell>{server.hostname}</TableCell>
                <TableCell>{server.ipAddress}</TableCell>
                <TableCell>{server.os}</TableCell>
                <TableCell>{server.environment}</TableCell>
                <TableCell>{server.application}</TableCell>
                <TableCell>{server.owner}</TableCell>
                <TableCell>{server.status}</TableCell>
                <TableCell className="flex gap-2">
                  <Link href={`/servers/${server.id}`} className="text-sm text-slate-700 underline">
                    View
                  </Link>
                  <Link
                    href={`/servers/${server.id}/edit`}
                    className="text-sm text-slate-700 underline"
                  >
                    Edit
                  </Link>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="text-sm text-red-600 underline">Delete</button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Delete {server.hostname}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This cannot be undone. The server record will be permanently removed.
                      </AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(server.id)}
                          >
                            Delete
                          </Button>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
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

`Button`'s `asChild` prop doesn't exist yet on the Phase 1 `Button` component (it's a plain `<button>`) — add it in this step since three call sites above need it:

Modify `frontend/components/ui/button.tsx`:

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-slate-900 text-white hover:bg-slate-700',
        outline: 'border border-slate-200 hover:bg-slate-100',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';
```

Run (from `frontend/`): `npm install @radix-ui/react-slot`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/servers-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Full frontend verification**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 6: Commit**

```bash
git add frontend/app/servers/page.tsx frontend/components/ui/button.tsx frontend/tests/servers-list.test.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add server list page with search, filter, pagination, and delete"
```

---

### Task 8: Server Details and Edit pages

**Files:**
- Create: `frontend/app/servers/[id]/page.tsx`
- Create: `frontend/app/servers/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `Server` type (Task 6), `ServerForm` (Task 6), `apiFetch`.

- [ ] **Step 1: Create `frontend/app/servers/[id]/page.tsx`**

```tsx
'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/apiClient';
import type { Server } from '@/types/server';

export default function ServerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: server, isLoading, isError } = useQuery<Server>({
    queryKey: ['servers', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/servers/${id}`);
      if (!res.ok) throw new Error('Failed to load server');
      return res.json();
    },
  });

  if (isLoading) return <main className="p-8">Loading...</main>;
  if (isError || !server) return <main className="p-8">Server not found.</main>;

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{server.hostname}</h1>
        <Button asChild>
          <Link href={`/servers/${server.id}/edit`}>Edit</Link>
        </Button>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Basic Information</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">IP Address</dt>
          <dd>{server.ipAddress}</dd>
          <dt className="text-slate-500">OS</dt>
          <dd>{server.os}</dd>
          <dt className="text-slate-500">Environment</dt>
          <dd>{server.environment}</dd>
          <dt className="text-slate-500">Application</dt>
          <dd>{server.application}</dd>
          <dt className="text-slate-500">Owner</dt>
          <dd>{server.owner}</dd>
          <dt className="text-slate-500">Location</dt>
          <dd>{server.location ?? '—'}</dd>
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Connection Information</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Username</dt>
          <dd>{server.username}</dd>
          <dt className="text-slate-500">SSH Port</dt>
          <dd>{server.sshPort}</dd>
          <dt className="text-slate-500">Assigned SSH Key</dt>
          <dd>{server.assignedKey?.name ?? 'None'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Activity</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Created</dt>
          <dd>{new Date(server.createdAt).toLocaleString()}</dd>
          <dt className="text-slate-500">Updated</dt>
          <dd>{new Date(server.updatedAt).toLocaleString()}</dd>
        </dl>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Create `frontend/app/servers/[id]/edit/page.tsx`**

```tsx
'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ServerForm, ServerFormValues } from '@/components/servers/ServerForm';
import { apiFetch } from '@/lib/apiClient';
import type { Server } from '@/types/server';

export default function EditServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data: server, isLoading } = useQuery<Server>({
    queryKey: ['servers', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/servers/${id}`);
      if (!res.ok) throw new Error('Failed to load server');
      return res.json();
    },
  });

  async function handleSubmit(values: ServerFormValues) {
    const res = await apiFetch(`/api/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to update server');
      return;
    }

    toast.success('Server updated');
    router.push(`/servers/${id}`);
  }

  if (isLoading) return <main className="p-8">Loading...</main>;
  if (!server) return <main className="p-8">Server not found.</main>;

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Edit {server.hostname}</h1>
      <ServerForm
        defaultValues={{
          hostname: server.hostname,
          ipAddress: server.ipAddress,
          os: server.os,
          environment: server.environment,
          application: server.application,
          owner: server.owner,
          location: server.location ?? undefined,
          username: server.username,
          sshPort: server.sshPort,
          description: server.description ?? undefined,
        }}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
      />
    </main>
  );
}
```

- [ ] **Step 3: Full frontend verification**

Run (from `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/servers/[id]"
git commit -m "feat(frontend): add server details and edit pages"
```

---

## Self-Review Notes

- **Spec coverage:** §5 Server Inventory table + search/filter/sort/pagination/actions → Task 7. §6 Add Server form → Task 6. §7 Server Details (Basic/Connection/Activity sections, Edit/Delete) → Task 8 (Assigned SSH Key shows "None" until Phase 5, called out in Global Constraints). RBAC enforcement (Admin/Operator/Viewer) → Task 4's tests.
- **Type consistency:** `Server`/`PaginatedServers` (Task 6) match exactly what the backend's `listServers`/`getServerById` (Task 3) return (`assignedKey`, timestamps as ISO strings over the wire). `ServerFormValues` field names match `CreateServerInput`/`UpdateServerInput` (Task 2) field-for-field so the same payload shape posts cleanly to both create and update endpoints.
- **No placeholders:** every step has literal code or literal commands with expected output.
