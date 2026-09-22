# Dynamic Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Metadata-driven custom inventory entities (user-defined field schemas, no real tables created per entity), record CRUD validated dynamically against those field definitions, and frontend pages that render entirely from that metadata. This is Phase 7.

**Architecture:** `InventoryEntity`/`InventoryField`/`InventoryRecord` already exist in the schema (Phase 2) — `InventoryRecord.data` is JSONB. The novel piece is `buildRecordDataSchema(fields)` in `inventoryService.ts`, which turns a `InventoryField[]` row set into a Zod object schema *at request time*, so every record write is validated against whatever fields that specific entity currently has — the same mechanism the frontend's `DynamicRecordForm` mirrors to render inputs (text/number/checkbox/date/select) per field, with no per-entity frontend code.

**Tech Stack:** No new dependencies.

**Spec:** Original request §12-13 (Dynamic Inventory UX + DB design), §16 (`/api/inventory/*` endpoints), §17 (`/inventory`, `/inventory/[id]` pages).

## Global Constraints

- No real Postgres table is created per entity — `InventoryRecord.data` (JSONB) holds all record data, exactly as specified.
- Entity creation is one request carrying `name` + `description?` + an array of field definitions (matching the request's described flow: "Create Inventory" → name → fields, as a single creation step, not a multi-request wizard). **Fields cannot be added or changed after entity creation in v1** — the original request's REST API section lists no field-mutation endpoints, and diffing/migrating existing JSONB records against a changed field set is real complexity this version doesn't need. If a schema needs to change, delete and recreate the entity.
- `PUT /api/inventory/entities/:id` only updates `name`/`description`, for the same reason.
- Permissions: creating an *entity* requires `inventory:create` (Admin only, per the original request's §11 role list — Operator's list has "Manage inventory" but not "Create inventory entity"). Updating/deleting an entity and all record CRUD require `inventory:manage` (Admin + Operator). Viewing entities/records requires `inventory:view` (all three roles) — Admin and Operator don't have this yet (same class of gap fixed for `server:view`/`key:view` in earlier phases), fixed in Task 1.
- Audited actions are exactly the four the original request's §14 action list names: `INVENTORY_CREATED`, `INVENTORY_UPDATED`, `INVENTORY_RECORD_CREATED`, `INVENTORY_RECORD_DELETED` — entity deletion and record updates aren't in that list, so they aren't audited here, following the same literal-reading-over-assumption approach used for the `key:assign` permission gap in Phase 5.

---

## File Structure

```
backend/src/
├── schemas/inventorySchemas.ts
├── services/inventoryService.ts       # includes buildRecordDataSchema
├── controllers/inventoryController.ts
└── routes/inventoryRoutes.ts
backend/tests/inventory.test.ts

frontend/
├── types/inventory.ts
├── components/inventory/
│   ├── EntityFieldBuilder.tsx         # dynamic field-definition builder for entity creation
│   └── DynamicRecordForm.tsx          # renders inputs from a field-definition array
├── app/inventory/page.tsx
└── app/inventory/[id]/page.tsx
frontend/tests/{dynamic-record-form,inventory-list}.test.tsx
```

---

### Task 1: Fix Admin/Operator missing `inventory:view` permission

**Files:**
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/tests/seed.test.ts`

- [ ] **Step 1: Add `'inventory:view'` to Admin and Operator**

In `backend/prisma/seed.ts`, add `'inventory:view'` to both `ROLE_PERMISSIONS.Admin` and `ROLE_PERMISSIONS.Operator` (Viewer already has it from Phase 1).

- [ ] **Step 2: Update expected counts in `backend/tests/seed.test.ts`**

```ts
    expect(admin?.permissions.length).toBe(14);
    expect(operator?.permissions.length).toBe(9);
    expect(viewer?.permissions.length).toBe(4);
```

- [ ] **Step 3: Run test** (against a real Postgres — see Task 4's verification step)

Run (from `backend/`): `npx jest tests/seed.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/seed.ts backend/tests/seed.test.ts
git commit -m "fix(backend): give Admin and Operator the inventory:view permission"
```

---

### Task 2: Inventory Zod schemas

**Files:**
- Create: `backend/src/schemas/inventorySchemas.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from 'zod';

export const fieldTypeEnum = z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT', 'TEXTAREA']);

export const createFieldSchema = z
  .object({
    fieldName: z.string().min(1).max(100),
    fieldType: fieldTypeEnum,
    required: z.boolean().default(false),
    options: z.array(z.string()).optional(),
    displayOrder: z.number().int().default(0),
  })
  .refine((f) => f.fieldType !== 'SELECT' || (f.options && f.options.length > 0), {
    message: 'SELECT fields must include at least one option',
    path: ['options'],
  });

export const createEntitySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  fields: z.array(createFieldSchema).min(1, 'At least one field is required'),
});

export const updateEntitySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
});

export const createRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export const updateRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export type CreateEntityInput = z.infer<typeof createEntitySchema>;
export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
```

- [ ] **Step 2: Typecheck**

Run (from `backend/`): `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/inventorySchemas.ts
git commit -m "feat(backend): add Zod schemas for dynamic inventory entities and records"
```

---

### Task 3: Inventory service (entities + dynamic record validation)

**Files:**
- Create: `backend/src/services/inventoryService.ts`

**Interfaces:**
- Produces: `InventoryEntityNotFoundError`, `DuplicateEntityNameError`, `InventoryRecordNotFoundError`, `InvalidRecordDataError`, `listEntities`, `getEntityById`, `createEntity`, `updateEntity`, `deleteEntity`, `listRecords`, `createRecord`, `updateRecord`, `deleteRecord` — Task 4's controller imports these exact names. `buildRecordDataSchema` is internal (not exported) — both `createRecord` and `updateRecord` call it themselves so callers never need to know it exists.

- [ ] **Step 1: Implement**

```ts
import { Prisma, FieldType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import type { CreateEntityInput, UpdateEntityInput } from '../schemas/inventorySchemas';

export class InventoryEntityNotFoundError extends Error {}
export class DuplicateEntityNameError extends Error {}
export class InventoryRecordNotFoundError extends Error {}
export class InvalidRecordDataError extends Error {
  constructor(public issues: z.ZodIssue[]) {
    super('Invalid record data');
  }
}

export async function listEntities() {
  return prisma.inventoryEntity.findMany({
    include: { fields: { orderBy: { displayOrder: 'asc' } }, _count: { select: { records: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getEntityById(id: string) {
  return prisma.inventoryEntity.findUnique({
    where: { id },
    include: { fields: { orderBy: { displayOrder: 'asc' } } },
  });
}

export async function createEntity(input: CreateEntityInput, createdById: string) {
  try {
    return await prisma.inventoryEntity.create({
      data: {
        name: input.name,
        description: input.description,
        createdById,
        fields: {
          create: input.fields.map((f) => ({
            fieldName: f.fieldName,
            fieldType: f.fieldType,
            required: f.required,
            options: f.options as Prisma.InputJsonValue | undefined,
            displayOrder: f.displayOrder,
          })),
        },
      },
      include: { fields: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateEntityNameError();
    }
    throw err;
  }
}

export async function updateEntity(id: string, input: UpdateEntityInput) {
  try {
    return await prisma.inventoryEntity.update({
      where: { id },
      data: input,
      include: { fields: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new InventoryEntityNotFoundError();
      if (err.code === 'P2002') throw new DuplicateEntityNameError();
    }
    throw err;
  }
}

export async function deleteEntity(id: string) {
  try {
    return await prisma.inventoryEntity.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new InventoryEntityNotFoundError();
    }
    throw err;
  }
}

function buildRecordDataSchema(
  fields: { fieldName: string; fieldType: FieldType; required: boolean; options: unknown }[],
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let schema: z.ZodTypeAny;
    switch (field.fieldType) {
      case 'NUMBER':
        schema = z.coerce.number();
        break;
      case 'BOOLEAN':
        schema = z.coerce.boolean();
        break;
      case 'SELECT': {
        const options = Array.isArray(field.options) ? (field.options as string[]) : [];
        schema = options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
        break;
      }
      default:
        schema = z.string();
    }
    shape[field.fieldName] = field.required ? schema : schema.optional().nullable();
  }
  return z.object(shape);
}

export async function createRecord(entityId: string, data: Record<string, unknown>, createdById: string) {
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
    include: { fields: true },
  });
  if (!entity) throw new InventoryEntityNotFoundError();

  const parsed = buildRecordDataSchema(entity.fields).safeParse(data);
  if (!parsed.success) throw new InvalidRecordDataError(parsed.error.issues);

  return prisma.inventoryRecord.create({
    data: { entityId, data: parsed.data as Prisma.InputJsonValue, createdById },
  });
}

export async function listRecords(entityId: string, page: number, pageSize: number) {
  const [data, total] = await Promise.all([
    prisma.inventoryRecord.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inventoryRecord.count({ where: { entityId } }),
  ]);
  return { data, total, page, pageSize };
}

export async function updateRecord(id: string, data: Record<string, unknown>) {
  const record = await prisma.inventoryRecord.findUnique({
    where: { id },
    include: { entity: { include: { fields: true } } },
  });
  if (!record) throw new InventoryRecordNotFoundError();

  const parsed = buildRecordDataSchema(record.entity.fields).safeParse(data);
  if (!parsed.success) throw new InvalidRecordDataError(parsed.error.issues);

  return prisma.inventoryRecord.update({
    where: { id },
    data: { data: parsed.data as Prisma.InputJsonValue },
  });
}

export async function deleteRecord(id: string) {
  try {
    return await prisma.inventoryRecord.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new InventoryRecordNotFoundError();
    }
    throw err;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/inventoryService.ts
git commit -m "feat(backend): add inventory entity service with dynamic per-entity record validation"
```

---

### Task 4: Inventory controller, routes, and integration tests

**Files:**
- Create: `backend/src/controllers/inventoryController.ts`
- Create: `backend/src/routes/inventoryRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/inventory.test.ts`

- [ ] **Step 1: Create `backend/src/controllers/inventoryController.ts`**

```ts
import { Request, Response } from 'express';
import {
  createEntitySchema,
  updateEntitySchema,
  createRecordSchema,
  updateRecordSchema,
} from '../schemas/inventorySchemas';
import {
  listEntities,
  getEntityById,
  createEntity,
  updateEntity,
  deleteEntity,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  InventoryEntityNotFoundError,
  DuplicateEntityNameError,
  InventoryRecordNotFoundError,
  InvalidRecordDataError,
} from '../services/inventoryService';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';

export async function listEntitiesHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listEntities());
}

export async function getEntityHandler(req: Request, res: Response): Promise<void> {
  const entity = await getEntityById(req.params.id);
  if (!entity) {
    res.status(404).json({ error: 'Inventory entity not found' });
    return;
  }
  res.status(200).json(entity);
}

export async function createEntityHandler(req: Request, res: Response): Promise<void> {
  const parsed = createEntitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const entity = await createEntity(parsed.data, req.user!.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_CREATED,
      resourceType: 'InventoryEntity',
      resourceId: entity.id,
      metadata: { name: entity.name },
      ...requestContext(req),
    });
    res.status(201).json(entity);
  } catch (err) {
    if (err instanceof DuplicateEntityNameError) {
      res.status(409).json({ error: 'An inventory entity with this name already exists' });
      return;
    }
    throw err;
  }
}

export async function updateEntityHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateEntitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const entity = await updateEntity(req.params.id, parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_UPDATED,
      resourceType: 'InventoryEntity',
      resourceId: entity.id,
      metadata: { name: entity.name },
      ...requestContext(req),
    });
    res.status(200).json(entity);
  } catch (err) {
    if (err instanceof InventoryEntityNotFoundError) {
      res.status(404).json({ error: 'Inventory entity not found' });
      return;
    }
    if (err instanceof DuplicateEntityNameError) {
      res.status(409).json({ error: 'An inventory entity with this name already exists' });
      return;
    }
    throw err;
  }
}

export async function deleteEntityHandler(req: Request, res: Response): Promise<void> {
  try {
    await deleteEntity(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof InventoryEntityNotFoundError) {
      res.status(404).json({ error: 'Inventory entity not found' });
      return;
    }
    throw err;
  }
}

export async function listRecordsHandler(req: Request, res: Response): Promise<void> {
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 20), 100);
  try {
    res.status(200).json(await listRecords(req.params.id, page, pageSize));
  } catch (err) {
    throw err;
  }
}

export async function createRecordHandler(req: Request, res: Response): Promise<void> {
  const parsed = createRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = await createRecord(req.params.id, parsed.data.data, req.user!.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_RECORD_CREATED,
      resourceType: 'InventoryRecord',
      resourceId: record.id,
      metadata: { entityId: req.params.id },
      ...requestContext(req),
    });
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof InventoryEntityNotFoundError) {
      res.status(404).json({ error: 'Inventory entity not found' });
      return;
    }
    if (err instanceof InvalidRecordDataError) {
      res.status(400).json({ error: 'Invalid record data', details: err.issues });
      return;
    }
    throw err;
  }
}

export async function updateRecordHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = await updateRecord(req.params.id, parsed.data.data);
    res.status(200).json(record);
  } catch (err) {
    if (err instanceof InventoryRecordNotFoundError) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    if (err instanceof InvalidRecordDataError) {
      res.status(400).json({ error: 'Invalid record data', details: err.issues });
      return;
    }
    throw err;
  }
}

export async function deleteRecordHandler(req: Request, res: Response): Promise<void> {
  try {
    const record = await deleteRecord(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_RECORD_DELETED,
      resourceType: 'InventoryRecord',
      resourceId: record.id,
      metadata: { entityId: record.entityId },
      ...requestContext(req),
    });
    res.status(204).send();
  } catch (err) {
    if (err instanceof InventoryRecordNotFoundError) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    throw err;
  }
}
```

- [ ] **Step 2: Add `INVENTORY_*` audit actions**

Modify `backend/src/services/auditService.ts`'s `AUDIT_ACTIONS`, adding:

```ts
  INVENTORY_CREATED: 'INVENTORY_CREATED',
  INVENTORY_UPDATED: 'INVENTORY_UPDATED',
  INVENTORY_RECORD_CREATED: 'INVENTORY_RECORD_CREATED',
  INVENTORY_RECORD_DELETED: 'INVENTORY_RECORD_DELETED',
```

- [ ] **Step 3: Create `backend/src/routes/inventoryRoutes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listEntitiesHandler,
  getEntityHandler,
  createEntityHandler,
  updateEntityHandler,
  deleteEntityHandler,
  listRecordsHandler,
  createRecordHandler,
  updateRecordHandler,
  deleteRecordHandler,
} from '../controllers/inventoryController';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/entities', requirePermission('inventory:view'), listEntitiesHandler);
inventoryRouter.post('/entities', requirePermission('inventory:create'), createEntityHandler);
inventoryRouter.get('/entities/:id', requirePermission('inventory:view'), getEntityHandler);
inventoryRouter.put('/entities/:id', requirePermission('inventory:manage'), updateEntityHandler);
inventoryRouter.delete('/entities/:id', requirePermission('inventory:manage'), deleteEntityHandler);
inventoryRouter.get('/entities/:id/records', requirePermission('inventory:view'), listRecordsHandler);
inventoryRouter.post(
  '/entities/:id/records',
  requirePermission('inventory:manage'),
  createRecordHandler,
);
inventoryRouter.put('/records/:id', requirePermission('inventory:manage'), updateRecordHandler);
inventoryRouter.delete('/records/:id', requirePermission('inventory:manage'), deleteRecordHandler);
```

- [ ] **Step 4: Wire into `backend/src/app.ts`**

```ts
import { inventoryRouter } from './routes/inventoryRoutes';
// ...
app.use('/api/roles', roleRouter);
app.use('/api/inventory', inventoryRouter);
// ...
app.use(errorHandler);
```

- [ ] **Step 5: Write the integration test — `backend/tests/inventory.test.ts`**

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

const NETWORK_DEVICE_FIELDS = [
  { fieldName: 'hostname', fieldType: 'TEXT', required: true, displayOrder: 0 },
  {
    fieldName: 'status',
    fieldType: 'SELECT',
    required: true,
    options: ['Active', 'Retired'],
    displayOrder: 1,
  },
  { fieldName: 'portCount', fieldType: 'NUMBER', required: false, displayOrder: 2 },
];

describe('dynamic inventory', () => {
  let adminAgent: ReturnType<typeof request.agent>;
  let operatorAgent: ReturnType<typeof request.agent>;
  let viewerAgent: ReturnType<typeof request.agent>;
  let entityId: string;

  beforeAll(async () => {
    await seed(prisma);
    await createTestUser('Operator', 'operator@example.com');
    await createTestUser('Viewer', 'viewer@example.com');

    adminAgent = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    operatorAgent = await loginAs('operator@example.com', 'Password123!');
    viewerAgent = await loginAs('viewer@example.com', 'Password123!');
  });

  afterAll(async () => {
    await prisma.inventoryEntity.deleteMany({ where: { name: 'Network Devices' } });
    await prisma.user.deleteMany({
      where: { email: { in: ['operator@example.com', 'viewer@example.com'] } },
    });
    await prisma.$disconnect();
  });

  it('rejects a non-admin creating an inventory entity', async () => {
    const res = await operatorAgent
      .post('/api/inventory/entities')
      .send({ name: 'Network Devices', fields: NETWORK_DEVICE_FIELDS });
    expect(res.status).toBe(403);
  });

  it('lets an admin create an entity with fields', async () => {
    const res = await adminAgent
      .post('/api/inventory/entities')
      .send({ name: 'Network Devices', fields: NETWORK_DEVICE_FIELDS });
    expect(res.status).toBe(201);
    expect(res.body.fields).toHaveLength(3);
    entityId = res.body.id;
  });

  it('lets a viewer list entities and records but not create a record', async () => {
    const entitiesRes = await viewerAgent.get('/api/inventory/entities');
    expect(entitiesRes.status).toBe(200);

    const recordsRes = await viewerAgent.get(`/api/inventory/entities/${entityId}/records`);
    expect(recordsRes.status).toBe(200);

    const createRes = await viewerAgent
      .post(`/api/inventory/entities/${entityId}/records`)
      .send({ data: { hostname: 'sw-01', status: 'Active' } });
    expect(createRes.status).toBe(403);
  });

  it('rejects a record missing a required field', async () => {
    const res = await operatorAgent
      .post(`/api/inventory/entities/${entityId}/records`)
      .send({ data: { hostname: 'sw-01' } });
    expect(res.status).toBe(400);
  });

  it('rejects a record with an invalid SELECT option', async () => {
    const res = await operatorAgent
      .post(`/api/inventory/entities/${entityId}/records`)
      .send({ data: { hostname: 'sw-01', status: 'NotAnOption' } });
    expect(res.status).toBe(400);
  });

  it('lets an operator create a valid record and then delete it', async () => {
    const createRes = await operatorAgent
      .post(`/api/inventory/entities/${entityId}/records`)
      .send({ data: { hostname: 'sw-01', status: 'Active', portCount: 48 } });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data).toEqual({ hostname: 'sw-01', status: 'Active', portCount: 48 });

    const deleteRes = await operatorAgent.delete(`/api/inventory/records/${createRes.body.id}`);
    expect(deleteRes.status).toBe(204);
  });

  it('records INVENTORY_CREATED and INVENTORY_RECORD_CREATED audit entries', async () => {
    const createdLogs = await adminAgent
      .get('/api/audit-logs')
      .query({ action: 'INVENTORY_CREATED' });
    expect(createdLogs.body.data.some((l: { resourceId: string }) => l.resourceId === entityId)).toBe(
      true,
    );

    const recordLogs = await adminAgent
      .get('/api/audit-logs')
      .query({ action: 'INVENTORY_RECORD_CREATED' });
    expect(recordLogs.body.data.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Provide a real Postgres, migrate, run the full backend suite**

```bash
docker run -d --name temp-postgres-inventory -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine
# wait for pg_isready, then from backend/:
npx prisma migrate deploy
npm test
```

Expected: all suites pass, including `tests/inventory.test.ts` and the updated `tests/seed.test.ts`.

- [ ] **Step 7: Lint, typecheck, tear down Postgres**

```bash
npm run lint && npx tsc --noEmit
docker stop temp-postgres-inventory && docker rm temp-postgres-inventory
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/controllers/inventoryController.ts backend/src/routes/inventoryRoutes.ts backend/src/services/auditService.ts backend/src/app.ts backend/tests/inventory.test.ts
git commit -m "feat(backend): add dynamic inventory entity/record routes with RBAC and audit"
```

---

### Task 5: Frontend types, dynamic field builder, dynamic record form

**Files:**
- Create: `frontend/types/inventory.ts`
- Create: `frontend/components/inventory/EntityFieldBuilder.tsx`
- Create: `frontend/components/inventory/DynamicRecordForm.tsx`
- Test: `frontend/tests/dynamic-record-form.test.tsx`

**Interfaces:**
- Produces: `InventoryField`, `InventoryEntity`, `InventoryEntitySummary`, `InventoryRecord`, `PaginatedInventoryRecords` types; `FieldDraft` type and `<EntityFieldBuilder fields onChange />`; `<DynamicRecordForm fields defaultValues? onSubmit submitLabel />` — Task 6's pages consume these exact names.

- [ ] **Step 1: Create `frontend/types/inventory.ts`**

```ts
export type FieldType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'SELECT' | 'TEXTAREA';

export interface InventoryField {
  id: string;
  fieldName: string;
  fieldType: FieldType;
  required: boolean;
  options: string[] | null;
  displayOrder: number;
}

export interface InventoryEntity {
  id: string;
  name: string;
  description: string | null;
  fields: InventoryField[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryEntitySummary extends InventoryEntity {
  _count: { records: number };
}

export interface InventoryRecord {
  id: string;
  entityId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedInventoryRecords {
  data: InventoryRecord[];
  total: number;
  page: number;
  pageSize: number;
}
```

- [ ] **Step 2: Write the failing test — `frontend/tests/dynamic-record-form.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DynamicRecordForm } from '../components/inventory/DynamicRecordForm';
import type { InventoryField } from '../types/inventory';

const FIELDS: InventoryField[] = [
  { id: 'f1', fieldName: 'hostname', fieldType: 'TEXT', required: true, options: null, displayOrder: 0 },
  {
    id: 'f2',
    fieldName: 'status',
    fieldType: 'SELECT',
    required: true,
    options: ['Active', 'Retired'],
    displayOrder: 1,
  },
  { id: 'f3', fieldName: 'inService', fieldType: 'BOOLEAN', required: false, options: null, displayOrder: 2 },
];

describe('DynamicRecordForm', () => {
  it('renders one input per field, matching its type', () => {
    render(<DynamicRecordForm fields={FIELDS} onSubmit={vi.fn()} submitLabel="Add" />);
    expect(screen.getByLabelText(/hostname/i)).toHaveProperty('tagName', 'INPUT');
    expect(screen.getByLabelText(/status/i)).toHaveProperty('tagName', 'SELECT');
    expect(screen.getByLabelText(/inService/i)).toHaveProperty('type', 'checkbox');
  });

  it('submits the entered values keyed by field name', async () => {
    const onSubmit = vi.fn();
    render(<DynamicRecordForm fields={FIELDS} onSubmit={onSubmit} submitLabel="Add" />);

    fireEvent.change(screen.getByLabelText(/hostname/i), { target: { value: 'sw-01' } });
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'Active' } });
    fireEvent.click(screen.getByLabelText(/inService/i));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ hostname: 'sw-01', status: 'Active', inService: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/dynamic-record-form.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 4: Create `frontend/components/inventory/DynamicRecordForm.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InventoryField } from '@/types/inventory';

interface DynamicRecordFormProps {
  fields: InventoryField[];
  defaultValues?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>;
  submitLabel: string;
}

export function DynamicRecordForm({
  fields,
  defaultValues,
  onSubmit,
  submitLabel,
}: DynamicRecordFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(defaultValues ?? {});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue(fieldName: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    await onSubmit(values);
    setIsSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {fields.map((field) => (
        <div key={field.id}>
          <Label htmlFor={field.fieldName}>
            {field.fieldName}
            {field.required ? ' *' : ''}
          </Label>
          {field.fieldType === 'TEXTAREA' && (
            <textarea
              id={field.fieldName}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              rows={3}
              required={field.required}
              value={(values[field.fieldName] as string) ?? ''}
              onChange={(e) => setValue(field.fieldName, e.target.value)}
            />
          )}
          {field.fieldType === 'BOOLEAN' && (
            <input
              id={field.fieldName}
              type="checkbox"
              checked={Boolean(values[field.fieldName])}
              onChange={(e) => setValue(field.fieldName, e.target.checked)}
            />
          )}
          {field.fieldType === 'SELECT' && (
            <select
              id={field.fieldName}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              required={field.required}
              value={(values[field.fieldName] as string) ?? ''}
              onChange={(e) => setValue(field.fieldName, e.target.value)}
            >
              <option value="">Select...</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          {(field.fieldType === 'TEXT' || field.fieldType === 'NUMBER' || field.fieldType === 'DATE') && (
            <Input
              id={field.fieldName}
              type={
                field.fieldType === 'NUMBER' ? 'number' : field.fieldType === 'DATE' ? 'date' : 'text'
              }
              required={field.required}
              value={(values[field.fieldName] as string) ?? ''}
              onChange={(e) => setValue(field.fieldName, e.target.value)}
            />
          )}
        </div>
      ))}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dynamic-record-form.test.tsx`
Expected: PASS — 2 passed

- [ ] **Step 6: Create `frontend/components/inventory/EntityFieldBuilder.tsx`**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FieldType } from '@/types/inventory';

export interface FieldDraft {
  fieldName: string;
  fieldType: FieldType;
  required: boolean;
  options: string; // comma-separated, used only when fieldType === 'SELECT'
}

const FIELD_TYPES: FieldType[] = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT', 'TEXTAREA'];

interface EntityFieldBuilderProps {
  fields: FieldDraft[];
  onChange: (fields: FieldDraft[]) => void;
}

export function EntityFieldBuilder({ fields, onChange }: EntityFieldBuilderProps) {
  function addField() {
    onChange([...fields, { fieldName: '', fieldType: 'TEXT', required: false, options: '' }]);
  }

  function updateField(index: number, patch: Partial<FieldDraft>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, index) => (
        <div
          key={index}
          className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-2"
        >
          <div>
            <Label htmlFor={`field-name-${index}`}>Field Name</Label>
            <Input
              id={`field-name-${index}`}
              value={field.fieldName}
              onChange={(e) => updateField(index, { fieldName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`field-type-${index}`}>Type</Label>
            <select
              id={`field-type-${index}`}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={field.fieldType}
              onChange={(e) => updateField(index, { fieldType: e.target.value as FieldType })}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          {field.fieldType === 'SELECT' && (
            <div>
              <Label htmlFor={`field-options-${index}`}>Options (comma-separated)</Label>
              <Input
                id={`field-options-${index}`}
                value={field.options}
                onChange={(e) => updateField(index, { options: e.target.value })}
              />
            </div>
          )}
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => updateField(index, { required: e.target.checked })}
            />
            Required
          </label>
          <button
            type="button"
            className="text-sm text-red-600 underline"
            onClick={() => removeField(index)}
          >
            Remove
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={addField}>
        Add Field
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and build**

Run (from `frontend/`): `npx tsc --noEmit && npm run build`
Expected: both exit 0

- [ ] **Step 8: Commit**

```bash
git add frontend/types/inventory.ts frontend/components/inventory frontend/tests/dynamic-record-form.test.tsx
git commit -m "feat(frontend): add dynamic field builder and dynamic record form components"
```

---

### Task 6: Inventory list page and entity detail page

**Files:**
- Create: `frontend/app/inventory/page.tsx`
- Create: `frontend/app/inventory/[id]/page.tsx`
- Test: `frontend/tests/inventory-list.test.tsx`

**Interfaces:**
- Consumes: everything from Task 5, `apiFetch`, `Table*`/`AlertDialog*`/`Dialog*` (earlier phases).

- [ ] **Step 1: Write the failing test — `frontend/tests/inventory-list.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InventoryPage from '../app/inventory/page';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('InventoryPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'e1',
            name: 'Network Devices',
            description: 'Switches and routers',
            fields: [
              { id: 'f1', fieldName: 'hostname', fieldType: 'TEXT', required: true, options: null, displayOrder: 0 },
            ],
            _count: { records: 3 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
  });

  it('renders inventory entities returned from the API', async () => {
    renderWithClient(<InventoryPage />);
    expect(await screen.findByText('Network Devices')).toBeDefined();
    expect(screen.getByText(/3 records/)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/inventory-list.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create `frontend/app/inventory/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { EntityFieldBuilder, FieldDraft } from '@/components/inventory/EntityFieldBuilder';
import { apiFetch } from '@/lib/apiClient';
import type { InventoryEntitySummary } from '@/types/inventory';

function CreateEntityDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([
    { fieldName: '', fieldType: 'TEXT', required: false, options: '' },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    const res = await apiFetch('/api/inventory/entities', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: description || undefined,
        fields: fields.map((f, i) => ({
          fieldName: f.fieldName,
          fieldType: f.fieldType,
          required: f.required,
          options:
            f.fieldType === 'SELECT'
              ? f.options
                  .split(',')
                  .map((o) => o.trim())
                  .filter(Boolean)
              : undefined,
          displayOrder: i,
        })),
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to create inventory entity');
      return;
    }

    toast.success('Inventory entity created');
    setOpen(false);
    setName('');
    setDescription('');
    setFields([{ fieldName: '', fieldType: 'TEXT', required: false, options: '' }]);
    queryClient.invalidateQueries({ queryKey: ['inventory-entities'] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Inventory</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Create Inventory Entity</DialogTitle>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="entity-name">Entity Name</Label>
            <Input id="entity-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="entity-description">Description</Label>
            <Input
              id="entity-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <EntityFieldBuilder fields={fields} onChange={setFields} />
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

export default function InventoryPage() {
  const { data: entities, isLoading, isError } = useQuery<InventoryEntitySummary[]>({
    queryKey: ['inventory-entities'],
    queryFn: async () => {
      const res = await apiFetch('/api/inventory/entities');
      if (!res.ok) throw new Error('Failed to load inventory entities');
      return res.json();
    },
  });

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dynamic Inventory</h1>
        <CreateEntityDialog />
      </div>

      {isLoading && <p>Loading inventory entities...</p>}
      {isError && <p className="text-red-600">Failed to load inventory entities.</p>}
      {entities && entities.length === 0 && <p className="text-slate-500">No inventory entities yet.</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entities?.map((entity) => (
          <Link
            key={entity.id}
            href={`/inventory/${entity.id}`}
            className="rounded-lg border border-slate-200 p-4 hover:bg-slate-50"
          >
            <h2 className="text-lg font-medium">{entity.name}</h2>
            {entity.description && <p className="text-sm text-slate-500">{entity.description}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {entity.fields.length} fields · {entity._count.records} records
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/inventory-list.test.tsx`
Expected: PASS

- [ ] **Step 5: Create `frontend/app/inventory/[id]/page.tsx`**

```tsx
'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
import { DynamicRecordForm } from '@/components/inventory/DynamicRecordForm';
import { apiFetch } from '@/lib/apiClient';
import type { InventoryEntity, PaginatedInventoryRecords } from '@/types/inventory';

export default function InventoryEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: entity } = useQuery<InventoryEntity>({
    queryKey: ['inventory-entities', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/inventory/entities/${id}`);
      if (!res.ok) throw new Error('Failed to load entity');
      return res.json();
    },
  });

  const { data: records } = useQuery<PaginatedInventoryRecords>({
    queryKey: ['inventory-records', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/inventory/entities/${id}/records`);
      if (!res.ok) throw new Error('Failed to load records');
      return res.json();
    },
    enabled: Boolean(entity),
  });

  const deleteMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const res = await apiFetch(`/api/inventory/records/${recordId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete record');
    },
    onSuccess: () => {
      toast.success('Record deleted');
      queryClient.invalidateQueries({ queryKey: ['inventory-records', id] });
    },
    onError: () => toast.error('Failed to delete record'),
  });

  async function handleAddRecord(data: Record<string, unknown>) {
    const res = await apiFetch(`/api/inventory/entities/${id}/records`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to add record');
      return;
    }
    toast.success('Record added');
    setAddOpen(false);
    queryClient.invalidateQueries({ queryKey: ['inventory-records', id] });
  }

  if (!entity) return <main className="p-8">Loading...</main>;

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{entity.name}</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>Add Record</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Add {entity.name} Record</DialogTitle>
            <div className="mt-4">
              <DynamicRecordForm fields={entity.fields} onSubmit={handleAddRecord} submitLabel="Add" />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {records && records.data.length === 0 && <p className="text-slate-500">No records yet.</p>}

      {records && records.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {entity.fields.map((field) => (
                <TableHead key={field.id}>{field.fieldName}</TableHead>
              ))}
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.data.map((record) => (
              <TableRow key={record.id}>
                {entity.fields.map((field) => (
                  <TableCell key={field.id}>{String(record.data[field.fieldName] ?? '')}</TableCell>
                ))}
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="text-sm text-red-600 underline">Delete</button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button variant="destructive" onClick={() => deleteMutation.mutate(record.id)}>
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

- [ ] **Step 6: Full frontend verification**

Run (from `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 7: Commit**

```bash
git add frontend/app/inventory frontend/tests/inventory-list.test.tsx
git commit -m "feat(frontend): add inventory list and entity detail pages"
```

---

## Self-Review Notes

- **Spec coverage:** §12 dynamic inventory UX (create entity with fields in one flow, dynamic table/form rendering) → Tasks 5-6. §13 metadata-driven DB design (no per-entity tables, JSONB records) → already true from Phase 2's schema, exercised here for the first time. §16 REST endpoints → Task 4, matching the exact path list. RBAC (`inventory:create` Admin-only, `inventory:manage` Admin+Operator, `inventory:view` all three) → Task 1 fix + Task 4's tests.
- **Type consistency:** `InventoryField`/`InventoryEntity` (Task 5) match `getEntityById`'s Prisma `include` shape (Task 3) field-for-field. `buildRecordDataSchema`'s per-`fieldType` branches (Task 3) are mirrored one-to-one by `DynamicRecordForm`'s per-`fieldType` input branches (Task 5) — the same six `FieldType` values drive both.
- **No placeholders:** every step has literal code or literal commands with expected output. The field-immutability limitation is called out explicitly in Global Constraints as a deliberate v1 scope decision.
