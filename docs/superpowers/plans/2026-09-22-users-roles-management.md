# Users & Roles Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User CRUD (`/api/users`) and a read-only role/permission listing (`/api/roles`), plus the `/users` and `/roles` frontend pages. This closes a gap in the original request: "Users" and "Roles & Permissions" are named modules with REST endpoints and frontend pages specified, and the Final Goal explicitly requires managing users/permissions from the UI, but the request's own Development Order (Phase 1-10) never assigns this a phase number. It's built here, between Phase 6 (Audit Logging, done) and Phase 7 (Dynamic Inventory), since Phase 6 already needs `USER_CREATED`/`USER_UPDATED`/`PERMISSION_CHANGED` audit actions that only make sense once this exists.

**Architecture:** Same Routes → Controllers → Services → Prisma layering as every other module. No new roles or permissions can be created in v1 — the original request lists no `POST`/`PUT` role endpoints in its REST API section, only the three seeded roles — so `/roles` is read-only and `roleRouter` only has a `GET`.

**Tech Stack:** `@radix-ui/react-dialog` (new) for the Add/Edit User modal forms — `AlertDialog` (Phase 4) is confirmation-only by design, not a general-purpose form container.

**Spec:** Original request §3 (Users, Roles & Permissions modules), §11 (RBAC — only Admin has `user:manage`/`role:manage`), §14 (User created/updated, Permission changes audit actions), §16 (`/api/users` endpoints), §17 (`/users`, `/roles` pages).

## Global Constraints

- Only Admin can manage users or view the roles/permissions list — enforced via `requirePermission('user:manage')` / `requirePermission('role:manage')`, both permissions already seeded to Admin only (Phase 1/5).
- `passwordHash` is never selected in any user query response — a dedicated Prisma `select` excludes it everywhere, the same pattern `keyService` uses for `storageRef`/`iv`/`authTag`.
- Changing a user's role fires a separate `PERMISSION_CHANGED` audit event in addition to `USER_UPDATED`, matching the original request's audit action list naming them as distinct events.
- No role creation/editing in v1 (see Architecture) — this is a deliberate scope limit, not an oversight.

---

## File Structure

```
backend/src/
├── schemas/userSchemas.ts
├── services/userService.ts
├── controllers/userController.ts
├── routes/userRoutes.ts
└── routes/roleRoutes.ts
backend/tests/users.test.ts

frontend/
├── types/user.ts
├── components/ui/dialog.tsx
├── app/users/page.tsx
└── app/roles/page.tsx
```

---

### Task 1: Add User/Role audit actions

**Files:**
- Modify: `backend/src/services/auditService.ts`

- [ ] **Step 1: Extend `AUDIT_ACTIONS`**

```ts
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
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',
} as const;
```

- [ ] **Step 2: Typecheck**

Run (from `backend/`): `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/auditService.ts
git commit -m "feat(backend): add user/permission audit actions"
```

---

### Task 2: User Zod schemas and service

**Files:**
- Create: `backend/src/schemas/userSchemas.ts`
- Create: `backend/src/services/userService.ts`

**Interfaces:**
- Produces: `createUserSchema`, `updateUserSchema`, `UserNotFoundError`, `DuplicateEmailError`, `listUsers`, `getUserById`, `createUser`, `updateUser` (returns `{ user, roleChanged }`), `deleteUser`, `listRoles` — Task 3's controller imports these exact names.

- [ ] **Step 1: Create `backend/src/schemas/userSchemas.ts`**

```ts
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(255),
  roleId: z.string().uuid(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  roleId: z.string().uuid().optional(),
  password: z.string().min(8).max(255).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

- [ ] **Step 2: Create `backend/src/services/userService.ts`**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hashPassword } from './passwordService';
import type { CreateUserInput, UpdateUserInput } from '../schemas/userSchemas';

export class UserNotFoundError extends Error {}
export class DuplicateEmailError extends Error {}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  authProvider: true,
  role: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
// passwordHash is intentionally excluded from every query below

export async function listUsers() {
  return prisma.user.findMany({ select: USER_SELECT, orderBy: { createdAt: 'desc' } });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: USER_SELECT });
}

export async function createUser(input: CreateUserInput) {
  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        roleId: input.roleId,
      },
      select: USER_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateEmailError();
    }
    throw err;
  }
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new UserNotFoundError();

  const roleChanged = input.roleId !== undefined && input.roleId !== existing.roleId;

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        roleId: input.roleId,
        passwordHash: input.password ? await hashPassword(input.password) : undefined,
      },
      select: USER_SELECT,
    });
    return { user, roleChanged };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new UserNotFoundError();
    }
    throw err;
  }
}

export async function deleteUser(id: string) {
  try {
    return await prisma.user.delete({ where: { id }, select: USER_SELECT });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new UserNotFoundError();
    }
    throw err;
  }
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((rp) => rp.permission.key),
  }));
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 4: Commit**

```bash
git add backend/src/schemas/userSchemas.ts backend/src/services/userService.ts
git commit -m "feat(backend): add user CRUD and read-only role listing service"
```

---

### Task 3: User/role controllers, routes, and integration tests

**Files:**
- Create: `backend/src/controllers/userController.ts`
- Create: `backend/src/routes/userRoutes.ts`
- Create: `backend/src/routes/roleRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/users.test.ts`

- [ ] **Step 1: Create `backend/src/controllers/userController.ts`**

```ts
import { Request, Response } from 'express';
import { createUserSchema, updateUserSchema } from '../schemas/userSchemas';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  listRoles,
  UserNotFoundError,
  DuplicateEmailError,
} from '../services/userService';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';

export async function listUsersHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listUsers());
}

export async function getUserHandler(req: Request, res: Response): Promise<void> {
  const user = await getUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(200).json(user);
}

export async function createUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const user = await createUser(parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.USER_CREATED,
      resourceType: 'User',
      resourceId: user.id,
      metadata: { email: user.email, role: user.role.name },
      ...requestContext(req),
    });
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }
    throw err;
  }
}

export async function updateUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const { user, roleChanged } = await updateUser(req.params.id, parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'User',
      resourceId: user.id,
      metadata: { email: user.email },
      ...requestContext(req),
    });
    if (roleChanged) {
      await logAudit({
        userId: req.user!.id,
        action: AUDIT_ACTIONS.PERMISSION_CHANGED,
        resourceType: 'User',
        resourceId: user.id,
        metadata: { email: user.email, newRole: user.role.name },
        ...requestContext(req),
      });
    }
    res.status(200).json(user);
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }
    throw err;
  }
}

export async function deleteUserHandler(req: Request, res: Response): Promise<void> {
  try {
    await deleteUser(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    throw err;
  }
}

export async function listRolesHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listRoles());
}
```

- [ ] **Step 2: Create `backend/src/routes/userRoutes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listUsersHandler,
  getUserHandler,
  createUserHandler,
  updateUserHandler,
  deleteUserHandler,
} from '../controllers/userController';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.use(requirePermission('user:manage'));

userRouter.get('/', listUsersHandler);
userRouter.post('/', createUserHandler);
userRouter.get('/:id', getUserHandler);
userRouter.put('/:id', updateUserHandler);
userRouter.delete('/:id', deleteUserHandler);
```

- [ ] **Step 3: Create `backend/src/routes/roleRoutes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { listRolesHandler } from '../controllers/userController';

export const roleRouter = Router();

roleRouter.use(requireAuth);
roleRouter.get('/', requirePermission('role:manage'), listRolesHandler);
```

- [ ] **Step 4: Wire into `backend/src/app.ts`**

```ts
import { userRouter } from './routes/userRoutes';
import { roleRouter } from './routes/roleRoutes';
// ...
app.use('/api/audit-logs', auditRouter);
app.use('/api/users', userRouter);
app.use('/api/roles', roleRouter);
// ...
app.use(errorHandler);
```

- [ ] **Step 5: Write the integration test — `backend/tests/users.test.ts`**

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
  return role;
}

describe('users & roles', () => {
  let adminAgent: ReturnType<typeof request.agent>;
  let operatorAgent: ReturnType<typeof request.agent>;
  let viewerRoleId: string;
  let operatorRoleId: string;

  beforeAll(async () => {
    await seed(prisma);
    const operatorRole = await createTestUser('Operator', 'operator@example.com');
    operatorRoleId = operatorRole.id;
    await createTestUser('Viewer', 'viewer@example.com');
    viewerRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'Viewer' } })).id;

    adminAgent = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    operatorAgent = await loginAs('operator@example.com', 'Password123!');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: ['operator@example.com', 'viewer@example.com', 'new-user@example.com'] } },
    });
    await prisma.$disconnect();
  });

  it('rejects a non-admin listing users', async () => {
    const res = await operatorAgent.get('/api/users');
    expect(res.status).toBe(403);
  });

  it('lets an admin create a user without exposing passwordHash', async () => {
    const res = await adminAgent.post('/api/users').send({
      email: 'new-user@example.com',
      name: 'New User',
      password: 'InitialPass123!',
      roleId: viewerRoleId,
    });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body.role.name).toBe('Viewer');
  });

  it('rejects a duplicate email', async () => {
    const res = await adminAgent.post('/api/users').send({
      email: 'new-user@example.com',
      name: 'Dup',
      password: 'InitialPass123!',
      roleId: viewerRoleId,
    });
    expect(res.status).toBe(409);
  });

  it("lets an admin change a user's role and logs a PERMISSION_CHANGED audit event", async () => {
    const list = await adminAgent.get('/api/users');
    const userId = list.body.find((u: { email: string }) => u.email === 'new-user@example.com').id;

    const res = await adminAgent.put(`/api/users/${userId}`).send({ roleId: operatorRoleId });
    expect(res.status).toBe(200);
    expect(res.body.role.name).toBe('Operator');

    const logs = await adminAgent.get('/api/audit-logs').query({ action: 'PERMISSION_CHANGED' });
    expect(logs.body.data.some((l: { resourceId: string }) => l.resourceId === userId)).toBe(true);
  });

  it('lets an admin delete a user', async () => {
    const list = await adminAgent.get('/api/users');
    const userId = list.body.find((u: { email: string }) => u.email === 'new-user@example.com').id;

    const res = await adminAgent.delete(`/api/users/${userId}`);
    expect(res.status).toBe(204);
  });

  it('only lets an admin view the roles list', async () => {
    const adminRes = await adminAgent.get('/api/roles');
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.find((r: { name: string }) => r.name === 'Admin').permissions).toContain(
      'user:manage',
    );

    const operatorRes = await operatorAgent.get('/api/roles');
    expect(operatorRes.status).toBe(403);
  });
});
```

- [ ] **Step 6: Provide a real Postgres, migrate, run the full backend suite**

```bash
docker run -d --name temp-postgres-users -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine
# wait for pg_isready, then from backend/:
npx prisma migrate deploy
npm test
```

Expected: all suites pass, including `tests/users.test.ts`.

- [ ] **Step 7: Lint, typecheck, tear down Postgres**

```bash
npm run lint && npx tsc --noEmit
docker stop temp-postgres-users && docker rm temp-postgres-users
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/userController.ts backend/src/routes/userRoutes.ts backend/src/routes/roleRoutes.ts backend/src/app.ts backend/tests/users.test.ts
git commit -m "feat(backend): add user CRUD and role listing routes with RBAC"
```

---

### Task 4: Frontend dialog primitive and user/role types

**Files:**
- Create: `frontend/components/ui/dialog.tsx`
- Create: `frontend/types/user.ts`

- [ ] **Step 1: Install `@radix-ui/react-dialog`**

Run (from `frontend/`): `npm install @radix-ui/react-dialog`

- [ ] **Step 2: Create `frontend/components/ui/dialog.tsx`**

```tsx
'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

export const DialogTitle = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />
);

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4 flex justify-end gap-2', className)} {...props} />;
}

export const DialogClose = DialogPrimitive.Close;
```

- [ ] **Step 3: Create `frontend/types/user.ts`**

```ts
export interface AppUser {
  id: string;
  email: string;
  name: string;
  authProvider: 'LOCAL' | 'OIDC';
  role: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface AppRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
}
```

- [ ] **Step 4: Typecheck and build**

Run (from `frontend/`): `npx tsc --noEmit && npm run build`
Expected: both exit 0

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/dialog.tsx frontend/types/user.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add Dialog primitive and user/role types"
```

---

### Task 5: Users page (list, add, edit role, delete)

**Files:**
- Create: `frontend/app/users/page.tsx`

- [ ] **Step 1: Create `frontend/app/users/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
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
import type { AppUser, AppRole } from '@/types/user';

const createUserSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleId: z.string().uuid('Select a role'),
});
type CreateUserValues = z.infer<typeof createUserSchema>;

function AddUserDialog({ roles }: { roles: AppRole[] }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserValues>({ resolver: zodResolver(createUserSchema) });

  async function onSubmit(values: CreateUserValues) {
    const res = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(values) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to create user');
      return;
    }
    toast.success('User created');
    reset();
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add User</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add User</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div>
            <Label htmlFor="password">Initial Password</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
          </div>
          <div>
            <Label htmlFor="roleId">Role</Label>
            <select
              id="roleId"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...register('roleId')}
            >
              <option value="">Select a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            {errors.roleId && <p className="text-sm text-red-600">{errors.roleId.message}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({ user, roles }: { user: AppUser; roles: AppRole[] }) {
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState(user.role.id);
  const queryClient = useQueryClient();

  async function handleSave() {
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ roleId }),
    });
    if (!res.ok) {
      toast.error('Failed to update role');
      return;
    }
    toast.success('Role updated');
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-sm text-slate-700 underline">Edit Role</button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Change role for {user.email}</DialogTitle>
        <div className="mt-4">
          <Label htmlFor={`role-${user.id}`}>Role</Label>
          <select
            id={`role-${user.id}`}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();

  const { data: users } = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiFetch('/api/users');
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
  });

  const { data: roles } = useQuery<AppRole[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await apiFetch('/api/roles');
      if (!res.ok) throw new Error('Failed to load roles');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete user');
    },
    onSuccess: () => {
      toast.success('User deleted');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Failed to delete user'),
  });

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        {roles && <AddUserDialog roles={roles} />}
      </div>

      {users && users.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.role.name}</TableCell>
                <TableCell className="flex gap-2">
                  {roles && <EditRoleDialog user={user} roles={roles} />}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="text-sm text-red-600 underline">Delete</button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Delete {user.email}?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button variant="destructive" onClick={() => deleteMutation.mutate(user.id)}>
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
    </main>
  );
}
```

- [ ] **Step 2: Full frontend verification**

Run (from `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 3: Commit**

```bash
git add frontend/app/users
git commit -m "feat(frontend): add users page with add/edit-role/delete"
```

---

### Task 6: Roles page (read-only)

**Files:**
- Create: `frontend/app/roles/page.tsx`

- [ ] **Step 1: Create `frontend/app/roles/page.tsx`**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiClient';
import type { AppRole } from '@/types/user';

export default function RolesPage() {
  const { data: roles, isLoading, isError } = useQuery<AppRole[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await apiFetch('/api/roles');
      if (!res.ok) throw new Error('Failed to load roles');
      return res.json();
    },
  });

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Roles & Permissions</h1>

      {isLoading && <p>Loading roles...</p>}
      {isError && <p className="text-red-600">Failed to load roles.</p>}

      <div className="flex flex-col gap-4">
        {roles?.map((role) => (
          <section key={role.id} className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-lg font-medium">{role.name}</h2>
            {role.description && <p className="text-sm text-slate-500">{role.description}</p>}
            <ul className="mt-2 flex flex-wrap gap-2">
              {role.permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
                >
                  {permission}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Full frontend verification**

Run (from `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 3: Commit**

```bash
git add frontend/app/roles
git commit -m "feat(frontend): add read-only roles and permissions page"
```

---

## Self-Review Notes

- **Spec coverage:** §16's `/api/users` CRUD endpoints → Task 3. §17's `/users`, `/roles` pages → Tasks 5, 6. §11's Admin-only `user:manage`/`role:manage` gating → Task 3's tests (`operatorAgent` gets 403 on both). §14's User created/updated/Permission changes audit actions → Task 1 + Task 3's controller.
- **Type consistency:** `AppUser`/`AppRole` (Task 4) match `USER_SELECT`'s shape and `listRoles`'s mapped shape (Task 2) field-for-field.
- **No placeholders:** every step has literal code or literal commands with expected output.
