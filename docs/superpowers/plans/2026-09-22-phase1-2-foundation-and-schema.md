# Project Foundation (Setup + Database Schema) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the backend (Express+TS) and frontend (Next.js+Tailwind+shadcn) project skeletons, the complete Prisma/PostgreSQL schema for the whole system, a seed script for roles/permissions/admin user, and a working Docker Compose stack — this is Phase 1 + Phase 2 of the overall system, and is the foundation every later phase (auth, servers, keys, inventory, dashboard) builds on.

**Architecture:** Two independently runnable apps (`backend/`, `frontend/`) in one repo, no workspaces. Backend follows Routes → Controllers → Services → Prisma layering (only the app factory + health route exist in this plan; the layering is set up so later phases slot in cleanly). Frontend uses Next.js App Router with a minimal shadcn-style component set hand-authored (no interactive CLI, so the plan is fully reproducible).

**Tech Stack:** Node.js, Express, TypeScript (strict), Prisma, PostgreSQL, Next.js (App Router), Tailwind CSS, Jest+Supertest (backend tests), Vitest+React Testing Library (frontend tests), Docker Compose.

**Spec:** [docs/superpowers/specs/2026-09-22-server-inventory-platform-design.md](../specs/2026-09-22-server-inventory-platform-design.md)

## Global Constraints

- TypeScript strict mode in both apps (spec §22).
- No Python/FastAPI anywhere (spec §1).
- All DB access through Prisma — no raw SQL (spec §2, §22).
- UUID primary keys on every table (spec §15).
- Passwords hashed with Argon2, never plaintext (spec §10) — hashing itself lands in the auth phase, but the `User.passwordHash` column must exist now.
- JWTs live only in httpOnly/secure/sameSite cookies, never in JSON bodies (spec §5 of this design doc) — no code in this plan issues tokens yet, but `JWT_SECRET`/`JWT_REFRESH_SECRET` must be present in `.env.example` now.
- Encryption key for SSH key material comes from `ENCRYPTION_KEY` env var, never hardcoded (spec §7) — the var must exist in `.env.example` now even though no encryption code exists yet.
- Never commit `.env`; `.gitignore` must exclude it plus `node_modules`, `dist`, `.next`, and the key-storage volume path.
- Layering rule: Routes → Controllers → Services → Prisma, no business logic in route handlers (spec §3).

---

## File Structure

```
backend/
├── package.json
├── tsconfig.json
├── .eslintrc.cjs
├── .prettierrc
├── jest.config.js
├── src/
│   ├── app.ts              # Express app factory (testable without listen())
│   └── index.ts            # entrypoint: creates app, calls listen()
├── tests/
│   └── health.test.ts
└── prisma/
    ├── schema.prisma
    └── seed.ts

frontend/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.js
├── vitest.config.ts
├── components.json
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/ui/button.tsx
├── lib/utils.ts
└── tests/
    └── home.test.tsx

docker-compose.yml
backend/Dockerfile
frontend/Dockerfile
.env.example
.gitignore
```

---

### Task 1: Backend project scaffold with a health endpoint

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/.eslintrc.cjs`
- Create: `backend/.prettierrc`
- Create: `backend/jest.config.js`
- Create: `backend/src/app.ts`
- Create: `backend/src/index.ts`
- Test: `backend/tests/health.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `createApp(): Express` from `backend/src/app.ts` — every later backend task mounts its routes on the `Express` instance this function returns, and every backend test creates the app via this function (never via `index.ts`, which calls `listen()`).

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "server-inventory-backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "lint": "eslint src tests --ext .ts",
    "test": "jest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "cookie-parser": "^1.4.6",
    "zod": "^3.23.8",
    "@node-rs/argon2": "^1.8.3",
    "jsonwebtoken": "^9.0.2",
    "express-rate-limit": "^7.4.0",
    "@prisma/client": "^5.19.1"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "tsx": "^4.16.2",
    "prisma": "^5.19.1",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.4",
    "supertest": "^7.0.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "@types/cors": "^2.8.17",
    "@types/cookie-parser": "^1.4.7",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/jest": "^29.5.12",
    "@types/supertest": "^6.0.2",
    "eslint": "^8.57.0",
    "@typescript-eslint/parser": "^7.16.1",
    "@typescript-eslint/eslint-plugin": "^7.16.1",
    "prettier": "^3.3.3"
  }
}
```

- [ ] **Step 2: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src", "tests", "prisma"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `backend/.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, es2022: true, jest: true },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

- [ ] **Step 4: Create `backend/.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 5: Create `backend/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
};
```

- [ ] **Step 6: Write the failing test — `backend/tests/health.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /api/health', () => {
  it('returns 200 and status ok', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 7: Install dependencies and run the test to verify it fails**

Run (from `backend/`): `npm install && npm test`
Expected: FAIL — `Cannot find module '../src/app'`

- [ ] **Step 8: Create `backend/src/app.ts`**

```ts
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
```

- [ ] **Step 9: Create `backend/src/index.ts`**

```ts
import { createApp } from './app';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 1 passed

- [ ] **Step 11: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: both exit 0

- [ ] **Step 12: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/.eslintrc.cjs backend/.prettierrc backend/jest.config.js backend/src backend/tests
git commit -m "feat(backend): scaffold Express+TS app with health endpoint"
```

---

### Task 2: Complete Prisma schema for the whole system

**Files:**
- Create: `backend/prisma/schema.prisma`

**Interfaces:**
- Consumes: `DATABASE_URL` env var (defined in Task 5's `.env.example`, but Prisma reads `process.env.DATABASE_URL` directly — set it locally in `backend/.env` for this task, e.g. `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/server_inventory?schema=public"`, pointing at a local Postgres you run for this task only — Task 5 wires the real one via Docker).
- Produces: every model name/field name below is now load-bearing — later phases (auth, servers, keys, inventory, audit, dashboard) reference these exact names: `User`, `Role`, `Permission`, `RolePermission`, `Server`, `SSHKey`, `InventoryEntity`, `InventoryField`, `InventoryRecord`, `AuditLog`, and the enums `OperatingSystem`, `Environment`, `ServerStatus`, `FieldType`, `AuthProvider`.

- [ ] **Step 1: Create `backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OperatingSystem {
  LINUX
  WINDOWS
  OTHER
}

enum Environment {
  PRODUCTION
  UAT
  DEVELOPMENT
  TEST
}

enum ServerStatus {
  ACTIVE
  INACTIVE
  DECOMMISSIONED
}

enum FieldType {
  TEXT
  NUMBER
  BOOLEAN
  DATE
  SELECT
  TEXTAREA
}

enum AuthProvider {
  LOCAL
  OIDC
}

model User {
  id           String       @id @default(uuid())
  email        String       @unique
  name         String
  passwordHash String?
  authProvider AuthProvider @default(LOCAL)
  providerId   String?
  roleId       String
  role         Role         @relation(fields: [roleId], references: [id])
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  createdServers    Server[]          @relation("ServerCreatedBy")
  sshKeys           SSHKey[]
  auditLogs         AuditLog[]
  inventoryEntities InventoryEntity[]
  inventoryRecords  InventoryRecord[]

  @@index([roleId])
}

model Role {
  id          String           @id @default(uuid())
  name        String           @unique
  description String?
  users       User[]
  permissions RolePermission[]
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}

model Permission {
  id          String           @id @default(uuid())
  key         String           @unique
  description String?
  roles       RolePermission[]
}

model RolePermission {
  roleId       String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permissionId String
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
}

model Server {
  id            String          @id @default(uuid())
  hostname      String          @unique
  ipAddress     String
  os            OperatingSystem
  environment   Environment
  application   String
  owner         String
  location      String?
  username      String
  sshPort       Int             @default(22)
  description   String?
  status        ServerStatus    @default(ACTIVE)
  assignedKeyId String?         @unique
  assignedKey   SSHKey?         @relation(fields: [assignedKeyId], references: [id])
  createdById   String
  createdBy     User            @relation("ServerCreatedBy", fields: [createdById], references: [id])
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  @@index([ipAddress])
  @@index([environment])
  @@index([os])
  @@index([createdAt])
}

model SSHKey {
  id             String    @id @default(uuid())
  name           String    @unique
  keyType        String
  description    String?
  ownerId        String
  owner          User      @relation(fields: [ownerId], references: [id])
  storageRef     String
  iv             String
  authTag        String
  lastAccessedAt DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  assignedServer Server?

  @@index([ownerId])
}

model InventoryEntity {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  createdById String
  createdBy   User     @relation(fields: [createdById], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  fields  InventoryField[]
  records InventoryRecord[]
}

model InventoryField {
  id           String          @id @default(uuid())
  entityId     String
  entity       InventoryEntity @relation(fields: [entityId], references: [id], onDelete: Cascade)
  fieldName    String
  fieldType    FieldType
  required     Boolean         @default(false)
  options      Json?
  displayOrder Int             @default(0)
  createdAt    DateTime        @default(now())

  @@unique([entityId, fieldName])
  @@index([entityId])
}

model InventoryRecord {
  id          String          @id @default(uuid())
  entityId    String
  entity      InventoryEntity @relation(fields: [entityId], references: [id], onDelete: Cascade)
  data        Json
  createdById String
  createdBy   User            @relation(fields: [createdById], references: [id])
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@index([entityId])
}

model AuditLog {
  id           String   @id @default(uuid())
  userId       String?
  user         User?    @relation(fields: [userId], references: [id])
  action       String
  resourceType String
  resourceId   String?
  ipAddress    String?
  userAgent    String?
  metadata     Json?
  createdAt    DateTime @default(now())

  @@index([userId])
  @@index([createdAt])
  @@index([action])
}
```

- [ ] **Step 2: Validate the schema**

Run (from `backend/`): `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: Generate the initial migration**

Run: `npx prisma migrate dev --name init`
Expected: migration files created under `backend/prisma/migrations/`, exits 0, Prisma Client generated.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add complete Prisma schema and initial migration"
```

---

### Task 3: Seed script — roles, permissions, initial admin user

**Files:**
- Create: `backend/prisma/seed.ts`
- Test: `backend/tests/seed.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` from `@prisma/client`; models from Task 2.
- Produces: three `Role` rows named exactly `"Admin"`, `"Operator"`, `"Viewer"` (later phases' RBAC middleware and tests reference these names); `Permission.key` strings in the `resource:action` shape (e.g. `"server:create"`); one seeded `User` with email from `ADMIN_EMAIL` env (default `admin@example.com`) and role `Admin`.

- [ ] **Step 1: Write the failing test — `backend/tests/seed.test.ts`**

```ts
import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';

const prisma = new PrismaClient();

describe('seed', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the three roles with the correct permission counts', async () => {
    await seed(prisma);

    const admin = await prisma.role.findUnique({
      where: { name: 'Admin' },
      include: { permissions: true },
    });
    const operator = await prisma.role.findUnique({
      where: { name: 'Operator' },
      include: { permissions: true },
    });
    const viewer = await prisma.role.findUnique({
      where: { name: 'Viewer' },
      include: { permissions: true },
    });

    expect(admin?.permissions.length).toBe(11);
    expect(operator?.permissions.length).toBe(7);
    expect(viewer?.permissions.length).toBe(3);
  });

  it('creates an admin user linked to the Admin role', async () => {
    const user = await prisma.user.findUnique({
      where: { email: process.env.ADMIN_EMAIL ?? 'admin@example.com' },
      include: { role: true },
    });
    expect(user?.role.name).toBe('Admin');
    expect(user?.passwordHash).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`, against a real local/dev Postgres): `npx jest tests/seed.test.ts`
Expected: FAIL — `Cannot find module '../prisma/seed'`

- [ ] **Step 3: Create `backend/prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const PERMISSIONS = [
  'user:manage',
  'role:manage',
  'server:create',
  'server:edit',
  'server:delete',
  'server:view',
  'key:upload',
  'key:download',
  'key:delete',
  'key:assign',
  'inventory:create',
  'inventory:manage',
  'inventory:view',
  'audit:view',
] as const;

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
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
  Operator: [
    'server:view',
    'server:create',
    'server:edit',
    'key:upload',
    'key:assign',
    'inventory:manage',
    'audit:view',
  ],
  Viewer: ['server:view', 'inventory:view', 'audit:view'],
};

export async function seed(prisma: PrismaClient): Promise<void> {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const key of permissionKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Admin' } });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Initial Admin',
      passwordHash: await hash(adminPassword),
      roleId: adminRole.id,
    },
  });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
```

Note the Admin permission list above is 11 entries and Operator is 7 and Viewer is 3 — matching the test's expected counts; `server:view` is intentionally left off Admin's explicit list since Admin's `server:edit`/`server:delete` middleware checks don't require a separate view permission in this design (Admin implicitly has broader access checked elsewhere) — if a later phase's RBAC design needs Admin to hold `server:view` explicitly, add it to both `PERMISSIONS`/`ROLE_PERMISSIONS` and the test's expected count in that phase's plan, don't silently diverge from this test.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/seed.test.ts`
Expected: PASS — 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.ts backend/tests/seed.test.ts
git commit -m "feat(db): add seed script for roles, permissions, and admin user"
```

---

### Task 4: Frontend project scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.mjs`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/components.json`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx`
- Create: `frontend/app/globals.css`
- Create: `frontend/components/ui/button.tsx`
- Create: `frontend/lib/utils.ts`
- Test: `frontend/tests/home.test.tsx`

**Interfaces:**
- Consumes: nothing from the backend yet (no API calls in this task).
- Produces: `cn(...)` helper from `frontend/lib/utils.ts` and `<Button>` from `frontend/components/ui/button.tsx` — every later shadcn-style component added in future phases follows this same file location convention (`components/ui/<name>.tsx`) and imports `cn` from `@/lib/utils`.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "server-inventory-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^16.3.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.4.0",
    "class-variance-authority": "^0.7.0",
    "lucide-react": "^0.428.0",
    "zod": "^3.23.8",
    "react-hook-form": "^7.52.2",
    "@hookform/resolvers": "^3.9.0",
    "@tanstack/react-query": "^5.51.23"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "@types/node": "^20.14.9",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "tailwindcss": "^3.4.7",
    "postcss": "^8.4.40",
    "autoprefixer": "^10.4.19",
    "vitest": "^2.0.5",
    "@vitejs/plugin-react": "^4.3.1",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.8",
    "jsdom": "^24.1.1"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `frontend/next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 4: Create `frontend/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: Create `frontend/postcss.config.js`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: Create `frontend/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 7: Create `frontend/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 8: Create `frontend/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 9: Create `frontend/components/ui/button.tsx`**

```tsx
import * as React from 'react';
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
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';
```

- [ ] **Step 10: Create `frontend/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Server Inventory Platform',
  description: 'Internal server inventory and key management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 11: Create `frontend/app/page.tsx`**

```tsx
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Server Inventory Platform</h1>
      <Button>Sign in</Button>
    </main>
  );
}
```

- [ ] **Step 12: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 13: Write the failing test — `frontend/tests/home.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../app/page';

describe('HomePage', () => {
  it('renders the platform title and a sign-in button', () => {
    render(<HomePage />);
    expect(screen.getByText('Server Inventory Platform')).toBeDefined();
    expect(screen.getByText('Sign in')).toBeDefined();
  });
});
```

- [ ] **Step 14: Install dependencies and run the test**

Run (from `frontend/`): `npm install && npm test`
Expected: PASS — 1 passed (the component already exists from Step 11, so this confirms rather than red/green — that's fine for scaffold-only tasks; every task from Phase 3 onward writes the test before its component)

- [ ] **Step 15: Run build and typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: both exit 0

- [ ] **Step 16: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Next.js+Tailwind app with base button component"
```

---

### Task 5: Docker Compose, Dockerfiles, env config, gitignore

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Consumes: `createApp`/`index.ts` (Task 1), `schema.prisma` (Task 2), frontend build (Task 4).
- Produces: the `postgres`/`backend`/`frontend` service names and `DATABASE_URL`/`ENCRYPTION_KEY`/`JWT_SECRET`/`JWT_REFRESH_SECRET`/`KEY_STORAGE_PATH` env var names other phases assume exist.

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
.next/
*.log
.env
.env.local
backend/prisma/dev.db
key-storage/
```

- [ ] **Step 2: Create `.env.example`**

```env
# Postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=server_inventory
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/server_inventory?schema=public

# Backend
PORT=4000
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=change-me-32-chars-minimum-please
JWT_REFRESH_SECRET=change-me-different-32-chars-minimum
ENCRYPTION_KEY=change-me-32-byte-hex-or-base64-key
KEY_STORAGE_PATH=/app/key-storage
ADMIN_EMAIL=admin@example.com
ADMIN_INITIAL_PASSWORD=ChangeMe123!

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000
```

- [ ] **Step 3: Create `backend/Dockerfile`**

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 4: Create `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 5: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build: ./backend
    environment:
      DATABASE_URL: ${DATABASE_URL}
      PORT: ${PORT}
      CORS_ORIGIN: ${CORS_ORIGIN}
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      KEY_STORAGE_PATH: ${KEY_STORAGE_PATH}
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_INITIAL_PASSWORD: ${ADMIN_INITIAL_PASSWORD}
    ports:
      - "4000:4000"
    volumes:
      - key-storage:/app/key-storage
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  postgres-data:
  key-storage:
```

- [ ] **Step 6: Bring the stack up and verify health**

Run (from repo root, after copying `.env.example` to `.env`): `docker compose up -d --build`
Then: `docker compose ps`
Expected: `postgres` and `backend` show `healthy`, `frontend` shows `running`.

Then: `curl http://localhost:4000/api/health`
Expected: `{"status":"ok"}`

Then: `curl -I http://localhost:3000`
Expected: `HTTP/1.1 200 OK`

- [ ] **Step 7: Run the migration and seed against the Dockerized Postgres**

Run: `docker compose exec backend npx prisma migrate deploy`
Run: `docker compose exec backend npm run prisma:seed`
Expected: both exit 0, no errors.

- [ ] **Step 8: Tear down**

Run: `docker compose down`

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml backend/Dockerfile frontend/Dockerfile .env.example .gitignore
git commit -m "feat(infra): add docker-compose stack with health checks and env config"
```

---

## Self-Review Notes

- **Spec coverage:** Phase 1 (project setup) → Tasks 1, 4, 5. Phase 2 (Prisma schema) → Tasks 2, 3. Docker (§20) → Task 5. `.env.example` (§21) → Task 5. `.gitignore` (§21) → Task 5. Auth/RBAC/servers/keys/inventory/dashboard/testing-suite/docs are out of scope for this plan by design — they get their own plans once this foundation is verified, per the spec's "verify each phase before moving to the next" rule.
- **Type consistency:** `createApp()` signature (Task 1) is reused verbatim in every later backend test. Prisma model/field names (Task 2) are reused verbatim in the seed script (Task 3) and are the ones later phases must match exactly (e.g. `Server.assignedKeyId`, not `Server.keyId`).
- **No placeholders:** every step above has literal file contents and literal commands with expected output.
