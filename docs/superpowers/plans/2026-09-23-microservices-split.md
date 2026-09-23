# Split into Auth/Inventory/Audit Microservices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single `backend/` Express app into three independently buildable, independently deployable services — `auth-service`, `inventory-service`, `audit-service` — each with its own Postgres database, wired together locally through an nginx gateway and `docker-compose`.

**Architecture:** Build all three new services as copies/adaptations of `backend/`'s existing code (Phases 1–3), wire them together with a gateway and rewritten `docker-compose.yml` plus two small frontend changes (Phase 4), verify the whole stack live, then delete `backend/` (Phase 5). `backend/` and the new services never run against the same data at the same time — `backend/` is stopped before the new stack's first boot.

**Tech Stack:** Same as `backend/` today per service (Express, TypeScript, Prisma/PostgreSQL, Zod, Jest) — no npm workspaces, each service is a fully independent Node project. New: `nginx` for local gateway routing, native `fetch` for service-to-service HTTP calls.

**Spec:** `docs/superpowers/specs/2026-09-23-microservices-split-design.md`

## Global Constraints

- No production data exists to migrate — the three new databases (`auth_db`, `inventory_db`, `audit_db`) start empty and are re-seeded (spec §10).
- One Postgres server, three separate **databases** (not Prisma schemas) — a service's `DATABASE_URL` must make it physically impossible to query another service's tables (spec §3).
- Cross-service foreign keys become plain scalar columns (`createdById`, `userId`) — no Prisma `@relation` across services (spec §3).
- `auth-service` keeps its existing DB-backed `requireAuth` (with silent refresh) unchanged. `inventory-service` and `audit-service` get a new JWT-signature-only `requireAuth` — no DB call, no network call to `auth-service`, per request (spec §4).
- Audit logging from `auth-service`/`inventory-service` becomes a best-effort (non-blocking, caught-on-failure) HTTP POST to `audit-service` — a slow/down `audit-service` must never fail the caller's real request (spec §5).
- Dashboard stats are composed client-side from two new small endpoints — no backend service queries across databases (spec §5).
- `requireAuth`/`requirePermission` are duplicated per service, not extracted into a shared package (spec §7).
- AWS deployment specifics (ECS/EKS/Lambda, Terraform/CDK, ECR, CI/CD) are explicitly out of scope for this plan (spec §11).

---

## Phase 1 — `auth-service`

### Task 1: Scaffold `auth-service` project

**Files:**
- Create: `auth-service/package.json`, `auth-service/tsconfig.json`, `auth-service/tsconfig.build.json`, `auth-service/jest.config.js`, `auth-service/jest.setup.js`, `auth-service/.eslintrc.cjs`, `auth-service/Dockerfile`, `auth-service/.env`, `auth-service/.gitignore`
- Create: `auth-service/certs/extra-ca.pem` (copy of `backend/certs/extra-ca.pem`)

**Interfaces:** none yet — this task only produces a buildable, empty-of-application-code project skeleton.

- [ ] **Step 1: Create the directory and copy the certs/config files verbatim**

```bash
mkdir -p auth-service/certs
cp backend/certs/extra-ca.pem auth-service/certs/extra-ca.pem
cp backend/.eslintrc.cjs auth-service/.eslintrc.cjs
cp backend/tsconfig.json auth-service/tsconfig.json
cp backend/tsconfig.build.json auth-service/tsconfig.build.json
cp backend/jest.setup.js auth-service/jest.setup.js
```

- [ ] **Step 2: Write `auth-service/package.json`**

```json
{
  "name": "auth-service",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "lint": "eslint src tests --ext .ts",
    "test": "jest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@node-rs/argon2": "^1.8.3",
    "@prisma/client": "^5.19.1",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.9",
    "@types/supertest": "^6.0.2",
    "@typescript-eslint/eslint-plugin": "^7.16.1",
    "@typescript-eslint/parser": "^7.16.1",
    "dotenv": "^18.0.2",
    "eslint": "^8.57.0",
    "jest": "^29.7.0",
    "prettier": "^3.3.3",
    "prisma": "^5.19.1",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.4",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4"
  }
}
```

(Dropped `multer` and its `@types` — `auth-service` never handles file uploads.)

- [ ] **Step 3: Write `auth-service/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  maxWorkers: 1,
};
```

- [ ] **Step 4: Write `auth-service/Dockerfile`** (identical to `backend/Dockerfile`, just documented as its own file)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY certs/ ./certs/
RUN touch ./certs/extra-ca.pem \
    && cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/certs ./certs
RUN cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./package.json
EXPOSE 4001
CMD ["node", "dist/index.js"]
```

(Port changed from `4000` to `4001` — each service gets its own port.)

- [ ] **Step 5: Write `auth-service/.gitignore`**

```
node_modules/
dist/
.env
```

- [ ] **Step 6: Write `auth-service/.env`** (not committed — matches `backend/.env`'s convention)

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_db?schema=public
PORT=4001
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=change-me-32-chars-minimum-please
JWT_REFRESH_SECRET=change-me-different-32-chars-minimum
ADMIN_EMAIL=admin@example.com
ADMIN_INITIAL_PASSWORD=ChangeMe123!
```

Use the **same** `JWT_SECRET` value already in `backend/.env` (copy it verbatim) — `inventory-service`/`audit-service` must share it to verify tokens `auth-service` signs. `JWT_REFRESH_SECRET` is only ever used by `auth-service`, so it doesn't need to match anything.

- [ ] **Step 7: Install dependencies**

```bash
cd auth-service && npm install
```

Expected: completes without error (this is a fresh `npm install`, no lockfile yet).

- [ ] **Step 8: Commit**

```bash
git add auth-service/package.json auth-service/package-lock.json auth-service/tsconfig.json auth-service/tsconfig.build.json auth-service/jest.config.js auth-service/jest.setup.js auth-service/.eslintrc.cjs auth-service/Dockerfile auth-service/.gitignore auth-service/certs
git commit -m "chore(auth-service): scaffold project"
```

---

### Task 2: `auth-service` Prisma schema and seed

**Files:**
- Create: `auth-service/prisma/schema.prisma`
- Create: `auth-service/prisma/seed.ts` (copy of `backend/prisma/seed.ts`, unchanged)

**Interfaces:**
- Produces: `User`, `Role`, `Permission`, `RolePermission` Prisma models and generated client, used by every later `auth-service` task.

- [ ] **Step 1: Write `auth-service/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
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
```

- [ ] **Step 2: Copy the seed file verbatim**

```bash
mkdir -p auth-service/prisma
cp backend/prisma/seed.ts auth-service/prisma/seed.ts
```

No content changes needed — it only ever touched `Permission`/`Role`/`RolePermission`/`User`, all of which now live here.

- [ ] **Step 3: Create the `auth_db` database on the running Postgres container**

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE auth_db;"
```

Expected: `CREATE DATABASE`. (If the `postgres` container isn't running, start just it: `docker compose up -d postgres`.)

- [ ] **Step 4: Generate and apply the initial migration**

```bash
cd auth-service && npx prisma migrate dev --name init
```

Expected: creates `auth-service/prisma/migrations/<timestamp>_init/migration.sql` and applies it to `auth_db`.

- [ ] **Step 5: Run the seed**

```bash
npx tsx prisma/seed.ts
```

Expected: no errors (creates 7/4/2 permissions for Admin/Operator/Viewer and the admin user).

- [ ] **Step 6: Commit**

```bash
git add auth-service/prisma
git commit -m "feat(auth-service): add Prisma schema (User/Role/Permission) and seed"
```

---

### Task 3: `auth-service` application code

**Files:**
- Create: `auth-service/src/lib/prisma.ts` (copy)
- Create: `auth-service/src/services/passwordService.ts` (copy)
- Create: `auth-service/src/services/tokenService.ts` (modified — `AccessTokenPayload` gains `roleName`/`permissions`)
- Create: `auth-service/src/services/authService.ts` (copy)
- Create: `auth-service/src/services/userService.ts` (modified — two new functions)
- Create: `auth-service/src/services/auditClient.ts` (new — best-effort HTTP audit logging)
- Create: `auth-service/src/middleware/requireAuth.ts` (modified — re-sign includes new claims)
- Create: `auth-service/src/middleware/requirePermission.ts` (copy)
- Create: `auth-service/src/middleware/errorHandler.ts` (copy, trimmed — no multer)
- Create: `auth-service/src/schemas/userSchemas.ts` (copy)
- Create: `auth-service/src/controllers/userController.ts` (modified — two new handlers)
- Create: `auth-service/src/routes/authRoutes.ts` (modified — new `/refresh` route, new claims, `auditClient` import)
- Create: `auth-service/src/routes/userRoutes.ts` (modified — two new routes)
- Create: `auth-service/src/routes/roleRoutes.ts` (copy)
- Create: `auth-service/src/app.ts` (modified — no server/inventory/audit/dashboard routers)
- Create: `auth-service/src/index.ts` (copy)

**Interfaces:**
- Consumes: `User`/`Role`/`Permission`/`RolePermission` Prisma client (Task 2).
- Produces: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/refresh` (new), `GET/POST/PUT/DELETE /api/users`, `GET /api/users/count` (new), `GET /api/users/lookup` (new), `GET /api/roles`. `AccessTokenPayload { sub, roleId, roleName, permissions }` — consumed by Task 6's `inventory-service` `requireAuth` and Task 8's `audit-service` `requireAuth`.

- [ ] **Step 1: Copy the unchanged files verbatim**

```bash
mkdir -p auth-service/src/lib auth-service/src/services auth-service/src/middleware auth-service/src/schemas auth-service/src/controllers auth-service/src/routes
cp backend/src/lib/prisma.ts auth-service/src/lib/prisma.ts
cp backend/src/services/passwordService.ts auth-service/src/services/passwordService.ts
cp backend/src/services/authService.ts auth-service/src/services/authService.ts
cp backend/src/middleware/requirePermission.ts auth-service/src/middleware/requirePermission.ts
cp backend/src/schemas/userSchemas.ts auth-service/src/schemas/userSchemas.ts
cp backend/src/routes/roleRoutes.ts auth-service/src/routes/roleRoutes.ts
cp backend/src/index.ts auth-service/src/index.ts
```

- [ ] **Step 2: Write `auth-service/src/middleware/errorHandler.ts`** (trimmed — no multer, since `auth-service` never receives file uploads)

```ts
import { Request, Response, NextFunction } from 'express';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 3: Write `auth-service/src/services/tokenService.ts`**

```ts
import jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_SECRET as string) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET as string) as AccessTokenPayload;
}
```

- [ ] **Step 4: Write `auth-service/src/services/auditClient.ts`** (new — replaces the old in-process `auditService.ts` import for services that don't own `AuditLog`)

```ts
import type { Request } from 'express';

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',
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
  try {
    const res = await fetch(`${process.env.AUDIT_SERVICE_URL}/internal/audit-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      console.warn('audit log write failed (non-fatal):', res.status);
    }
  } catch (err) {
    console.warn('audit log write failed (non-fatal):', err);
  }
}
```

- [ ] **Step 5: Write `auth-service/src/middleware/requireAuth.ts`** (same DB-backed shape as today, only the two re-sign call sites gain the new claims)

```ts
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyRefreshToken, signAccessToken } from '../services/tokenService';
import { getUserById, AuthenticatedUser } from '../services/authService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

export function setAccessCookie(res: Response, token: string): void {
  res.cookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const accessToken = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;

  if (accessToken) {
    try {
      const payload = verifyAccessToken(accessToken);
      const user = await getUserById(payload.sub);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.user = user;
      next();
      return;
    } catch {
      // access token invalid/expired -- fall through to refresh
    }
  }

  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      const user = await getUserById(payload.sub);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      setAccessCookie(
        res,
        signAccessToken({
          sub: user.id,
          roleId: user.role.id,
          roleName: user.role.name,
          permissions: user.role.permissions,
        }),
      );
      req.user = user;
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}
```

- [ ] **Step 6: Add two new functions to `auth-service/src/services/userService.ts`**

Copy `backend/src/services/userService.ts` to `auth-service/src/services/userService.ts`, then append:

```ts
export async function countUsers(): Promise<number> {
  return prisma.user.count();
}

export async function lookupUsers(ids: string[]) {
  return prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
}
```

- [ ] **Step 7: Add two new handlers to `auth-service/src/controllers/userController.ts`**

Copy `backend/src/controllers/userController.ts` to `auth-service/src/controllers/userController.ts`, change the import line from:

```ts
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
```

to:

```ts
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  listRoles,
  countUsers,
  lookupUsers,
  UserNotFoundError,
  DuplicateEmailError,
} from '../services/userService';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditClient';
```

then append two new handlers at the end of the file:

```ts
export async function countUsersHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ totalUsers: await countUsers() });
}

export async function lookupUsersHandler(req: Request, res: Response): Promise<void> {
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    res.status(200).json([]);
    return;
  }
  res.status(200).json(await lookupUsers(ids));
}
```

- [ ] **Step 8: Write `auth-service/src/routes/userRoutes.ts`**

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
  countUsersHandler,
  lookupUsersHandler,
} from '../controllers/userController';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.get('/count', countUsersHandler);
userRouter.get('/lookup', lookupUsersHandler);
userRouter.get('/', requirePermission('user:manage'), listUsersHandler);
userRouter.post('/', requirePermission('user:manage'), createUserHandler);
userRouter.get('/:id', requirePermission('user:manage'), getUserHandler);
userRouter.put('/:id', requirePermission('user:manage'), updateUserHandler);
userRouter.delete('/:id', requirePermission('user:manage'), deleteUserHandler);
```

`/count` and `/lookup` are declared **before** the `requirePermission('user:manage')`-gated routes and deliberately have no permission check beyond `requireAuth` — any logged-in user may call them (spec §5: they expose only a count and non-sensitive display fields). Order matters here so `/count` and `/lookup` don't get shadowed by `/:id`.

- [ ] **Step 9: Write `auth-service/src/routes/authRoutes.ts`**

```ts
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, getUserById, InvalidCredentialsError } from '../services/authService';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../services/tokenService';
import {
  requireAuth,
  setAccessCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../middleware/requireAuth';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditClient';
import type { AuthenticatedUser } from '../services/authService';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function tokenPayloadFor(user: AuthenticatedUser) {
  return {
    sub: user.id,
    roleId: user.role.id,
    roleName: user.role.name,
    permissions: user.role.permissions,
  };
}

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    const payload = tokenPayloadFor(user);
    setAccessCookie(res, signAccessToken(payload));
    res.cookie(REFRESH_COOKIE, signRefreshToken(payload), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });

    await logAudit({
      userId: user.id,
      action: AUDIT_ACTIONS.LOGIN,
      resourceType: 'User',
      resourceId: user.id,
      ...requestContext(req),
    });

    res.status(200).json({ id: user.id, email: user.email, name: user.name, role: user.role.name });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    throw err;
  }
});

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

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.status(200).json({
    id: req.user!.id,
    email: req.user!.email,
    name: req.user!.name,
    role: req.user!.role.name,
    permissions: req.user!.role.permissions,
  });
});

// Used by inventory-service/audit-service's frontend calls: when either of
// those services returns 401 (their JWT-only requireAuth cannot silently
// refresh, since it has no DB access), the frontend calls this endpoint to
// mint a fresh access token from the still-valid refresh token, then retries
// the original request once. See frontend/lib/apiClient.ts (Task 11).
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!refreshToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = await getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    setAccessCookie(res, signAccessToken(tokenPayloadFor(user)));
    res.status(200).json({ success: true });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
```

- [ ] **Step 10: Write `auth-service/src/app.ts`**

```ts
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/authRoutes';
import { userRouter } from './routes/userRoutes';
import { roleRouter } from './routes/roleRoutes';
import { errorHandler } from './middleware/errorHandler';

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

  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/roles', roleRouter);

  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 11: Typecheck**

```bash
cd auth-service && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add auth-service/src
git commit -m "feat(auth-service): add application code (login, users, roles, refresh)"
```

---

### Task 4: `auth-service` tests

**Files:**
- Create: `auth-service/tests/auth.test.ts` (adapted from `backend/tests/auth.test.ts`)
- Create: `auth-service/tests/users.test.ts` (adapted from `backend/tests/users.test.ts`)
- Create: `auth-service/tests/passwordService.test.ts` (copy)
- Create: `auth-service/tests/tokenService.test.ts` (adapted — new payload fields)
- Create: `auth-service/tests/requirePermission.test.ts` (copy)
- Create: `auth-service/tests/seed.test.ts` (copy)

**Interfaces:**
- Consumes: `auth-service`'s app (Task 3), `global.fetch` mocked to avoid real network calls to `audit-service` during tests.

- [ ] **Step 1: Copy the two files that need no changes**

```bash
mkdir -p auth-service/tests
cp backend/tests/passwordService.test.ts auth-service/tests/passwordService.test.ts
cp backend/tests/requirePermission.test.ts auth-service/tests/requirePermission.test.ts
cp backend/tests/seed.test.ts auth-service/tests/seed.test.ts
```

- [ ] **Step 2: Write `auth-service/tests/tokenService.test.ts`** (payload now needs `roleName`/`permissions`)

```ts
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../src/services/tokenService';

const PAYLOAD = { sub: 'user-1', roleId: 'role-1', roleName: 'Admin', permissions: ['user:manage'] };

describe('tokenService', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken(PAYLOAD);
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.roleId).toBe('role-1');
    expect(payload.roleName).toBe('Admin');
    expect(payload.permissions).toEqual(['user:manage']);
  });

  it('signs and verifies a refresh token', () => {
    const token = signRefreshToken(PAYLOAD);
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-1');
  });

  it('rejects a tampered access token', () => {
    const token = signAccessToken(PAYLOAD);
    expect(() => verifyAccessToken(`${token}tampered`)).toThrow();
  });
});
```

- [ ] **Step 3: Write `auth-service/tests/auth.test.ts`** (mocks `global.fetch` so `logAudit`'s HTTP call never hits a real network during tests, and adds coverage for the new `/refresh` route)

```ts
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { seed } from '../prisma/seed';

const app = createApp();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';

describe('auth', () => {
  beforeAll(async () => {
    await seed(prisma);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid admin credentials and sets both cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Admin');
      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
    });

    it('rejects invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: 'wrong-password' });

      expect(res.status).toBe(401);
    });

    it('rejects a malformed request body', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without a session', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns the current user and permissions when authenticated', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Admin');
      expect(res.body.permissions).toContain('user:manage');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rejects a request with no refresh cookie', async () => {
      const res = await request(app).post('/api/auth/refresh');
      expect(res.status).toBe(401);
    });

    it('issues a new access token from a valid refresh cookie', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      const res = await agent.post('/api/auth/refresh');
      expect(res.status).toBe(200);
      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears both cookies', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('access_token=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refresh_token=;'))).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Write `auth-service/tests/users.test.ts`** (mocks `global.fetch`; replaces the cross-service `GET /api/audit-logs` assertion with a check that `logAudit`'s HTTP call was made with the right body, since `audit-service` isn't reachable from this test run — spec §9)

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
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    await seed(prisma);
    const operatorRole = await createTestUser('Operator', 'operator@example.com');
    operatorRoleId = operatorRole.id;
    await createTestUser('Viewer', 'viewer@example.com');
    viewerRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: 'Viewer' } })).id;

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    adminAgent = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    operatorAgent = await loginAs('operator@example.com', 'Password123!');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
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

  it("lets an admin change a user's role and POSTs a PERMISSION_CHANGED event to audit-service", async () => {
    const list = await adminAgent.get('/api/users');
    const userId = list.body.find((u: { email: string }) => u.email === 'new-user@example.com').id;

    fetchSpy.mockClear();
    const res = await adminAgent.put(`/api/users/${userId}`).send({ roleId: operatorRoleId });
    expect(res.status).toBe(200);
    expect(res.body.role.name).toBe('Operator');

    const permissionChangedCall = fetchSpy.mock.calls.find(([, init]) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return body.action === 'PERMISSION_CHANGED' && body.resourceId === userId;
    });
    expect(permissionChangedCall).toBeDefined();
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

  it('lets any authenticated user get the user count and look up names by id, without user:manage', async () => {
    const countRes = await operatorAgent.get('/api/users/count');
    expect(countRes.status).toBe(200);
    expect(countRes.body.totalUsers).toBeGreaterThanOrEqual(1);

    const adminId = (await adminAgent.get('/api/auth/me')).body.id;
    const lookupRes = await operatorAgent.get('/api/users/lookup').query({ ids: adminId });
    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body[0]).toMatchObject({ id: adminId, email: ADMIN_EMAIL });
  });
});
```

- [ ] **Step 5: Run the full `auth-service` suite**

```bash
cd auth-service && npx jest --runInBand
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit && npx eslint src tests --ext .ts
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add auth-service/tests
git commit -m "test(auth-service): add auth, users, roles, tokenService, seed, requirePermission tests"
```

---

## Phase 2 — `inventory-service`

### Task 5: Scaffold `inventory-service` project and Prisma schema

**Files:**
- Create: `inventory-service/package.json`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.js`, `jest.setup.js`, `.eslintrc.cjs`, `Dockerfile`, `.env`, `.gitignore`, `certs/extra-ca.pem`
- Create: `inventory-service/prisma/schema.prisma`

**Interfaces:**
- Produces: `InventoryEntity`, `InventoryField`, `InventoryRecord` Prisma models and client, used by Task 6.

- [ ] **Step 1: Scaffold config files** (same pattern as Task 1)

```bash
mkdir -p inventory-service/certs inventory-service/prisma
cp backend/certs/extra-ca.pem inventory-service/certs/extra-ca.pem
cp backend/.eslintrc.cjs inventory-service/.eslintrc.cjs
cp backend/tsconfig.json inventory-service/tsconfig.json
cp backend/tsconfig.build.json inventory-service/tsconfig.build.json
cp backend/jest.setup.js inventory-service/jest.setup.js
```

- [ ] **Step 2: Write `inventory-service/package.json`**

```json
{
  "name": "inventory-service",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "lint": "eslint src tests --ext .ts",
    "test": "jest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^5.19.1",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "multer": "^2.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/multer": "^2.2.0",
    "@types/node": "^20.14.9",
    "@types/supertest": "^6.0.2",
    "@typescript-eslint/eslint-plugin": "^7.16.1",
    "@typescript-eslint/parser": "^7.16.1",
    "dotenv": "^18.0.2",
    "eslint": "^8.57.0",
    "jest": "^29.7.0",
    "prettier": "^3.3.3",
    "prisma": "^5.19.1",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.4",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4"
  }
}
```

(No `@node-rs/argon2`, no `express-rate-limit` — `inventory-service` doesn't hash passwords or rate-limit a login route.)

- [ ] **Step 3: Write `inventory-service/jest.config.js`** (identical pattern to `auth-service/jest.config.js`)

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  maxWorkers: 1,
};
```

- [ ] **Step 4: Write `inventory-service/Dockerfile`** (port `4002`)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY certs/ ./certs/
RUN touch ./certs/extra-ca.pem \
    && cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/certs ./certs
RUN cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./package.json
EXPOSE 4002
CMD ["node", "dist/index.js"]
```

- [ ] **Step 5: Write `inventory-service/.gitignore`**

```
node_modules/
dist/
.env
key-storage/
```

- [ ] **Step 6: Write `inventory-service/.env`**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inventory_db?schema=public
PORT=4002
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=change-me-32-chars-minimum-please
ENCRYPTION_KEY=change-me-32-byte-hex-or-base64-key
KEY_STORAGE_PATH=./key-storage
AUDIT_SERVICE_URL=http://localhost:4003
```

`JWT_SECRET` and `ENCRYPTION_KEY` must be the **same values** already in `backend/.env` — copy them verbatim (the encryption key must match because it decrypts secrets already written under it once `backend/`'s data is gone anyway; matching it now avoids a second thing to remember).

- [ ] **Step 7: Write `inventory-service/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum FieldType {
  TEXT
  NUMBER
  BOOLEAN
  DATE
  SELECT
  TEXTAREA
  SSH_KEY
  PASSWORD
}

model InventoryEntity {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  createdById String
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
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@index([entityId])
}
```

(`InventoryEntity.createdById` and `InventoryRecord.createdById` are plain `String` columns — the `createdBy User @relation(...)` field is gone, since `User` no longer lives in this schema, per spec §3.)

- [ ] **Step 8: Install dependencies**

```bash
cd inventory-service && npm install
```

- [ ] **Step 9: Create the `inventory_db` database and run the initial migration**

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE inventory_db;"
cd inventory-service && npx prisma migrate dev --name init
```

Expected: `CREATE DATABASE`, then a new migration applied to `inventory_db`.

- [ ] **Step 10: Commit**

```bash
git add inventory-service/package.json inventory-service/package-lock.json inventory-service/tsconfig.json inventory-service/tsconfig.build.json inventory-service/jest.config.js inventory-service/jest.setup.js inventory-service/.eslintrc.cjs inventory-service/Dockerfile inventory-service/.gitignore inventory-service/certs inventory-service/prisma
git commit -m "chore(inventory-service): scaffold project and Prisma schema"
```

---

### Task 6: `inventory-service` application code

**Files:**
- Create: `inventory-service/src/lib/prisma.ts` (copy)
- Create: `inventory-service/src/lib/secretCrypto.ts` (copy)
- Create: `inventory-service/src/storage/StorageProvider.ts`, `LocalFilesystemStorageProvider.ts` (copies)
- Create: `inventory-service/src/services/inventoryService.ts` (copy, unchanged — it never imported `auditService` directly)
- Create: `inventory-service/src/services/auditClient.ts` (new — same pattern as `auth-service`'s, but with the inventory-relevant `AUDIT_ACTIONS`)
- Create: `inventory-service/src/middleware/requireAuth.ts` (new — JWT-only)
- Create: `inventory-service/src/middleware/requirePermission.ts` (new — flat `req.user.permissions`)
- Create: `inventory-service/src/middleware/errorHandler.ts` (copy — keeps the multer-error branch)
- Create: `inventory-service/src/schemas/inventorySchemas.ts` (copy)
- Create: `inventory-service/src/controllers/inventoryController.ts` (modified — import path, new stats handler)
- Create: `inventory-service/src/routes/inventoryRoutes.ts` (modified — new `/stats` route)
- Create: `inventory-service/src/app.ts` (new — only mounts inventory)
- Create: `inventory-service/src/index.ts` (copy)

**Interfaces:**
- Consumes: `AccessTokenPayload { sub, roleId, roleName, permissions }` (Task 3) via shared `JWT_SECRET`.
- Produces: `GET/POST/PUT/DELETE /api/inventory/...` (all existing routes, unchanged paths/behavior), `GET /api/inventory/stats` (new, `{ totalEntities, totalRecords }`).

- [ ] **Step 1: Copy the unchanged files verbatim**

```bash
mkdir -p inventory-service/src/lib inventory-service/src/storage inventory-service/src/services inventory-service/src/middleware inventory-service/src/schemas inventory-service/src/controllers inventory-service/src/routes
cp backend/src/lib/prisma.ts inventory-service/src/lib/prisma.ts
cp backend/src/lib/secretCrypto.ts inventory-service/src/lib/secretCrypto.ts
cp backend/src/storage/StorageProvider.ts inventory-service/src/storage/StorageProvider.ts
cp backend/src/storage/LocalFilesystemStorageProvider.ts inventory-service/src/storage/LocalFilesystemStorageProvider.ts
cp backend/src/services/inventoryService.ts inventory-service/src/services/inventoryService.ts
cp backend/src/schemas/inventorySchemas.ts inventory-service/src/schemas/inventorySchemas.ts
cp backend/src/middleware/errorHandler.ts inventory-service/src/middleware/errorHandler.ts
cp backend/src/index.ts inventory-service/src/index.ts
```

- [ ] **Step 2: Write `inventory-service/src/middleware/requireAuth.ts`** (JWT-signature-only — no DB call, no call to `auth-service`)

```ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface RequestUser {
  id: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

const ACCESS_COOKIE = 'access_token';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AccessTokenPayload;
    req.user = {
      id: payload.sub,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
```

- [ ] **Step 3: Write `inventory-service/src/middleware/requirePermission.ts`** (flat shape, matching the `requireAuth.ts` above)

```ts
import { Request, Response, NextFunction } from 'express';

export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.user.permissions.includes(permissionKey)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Write `inventory-service/src/services/auditClient.ts`**

```ts
import type { Request } from 'express';

export const AUDIT_ACTIONS = {
  INVENTORY_CREATED: 'INVENTORY_CREATED',
  INVENTORY_UPDATED: 'INVENTORY_UPDATED',
  INVENTORY_RECORD_CREATED: 'INVENTORY_RECORD_CREATED',
  INVENTORY_RECORD_DELETED: 'INVENTORY_RECORD_DELETED',
  INVENTORY_RECORDS_IMPORTED: 'INVENTORY_RECORDS_IMPORTED',
  CREDENTIAL_VIEWED: 'CREDENTIAL_VIEWED',
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
  try {
    const res = await fetch(`${process.env.AUDIT_SERVICE_URL}/internal/audit-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      console.warn('audit log write failed (non-fatal):', res.status);
    }
  } catch (err) {
    console.warn('audit log write failed (non-fatal):', err);
  }
}
```

- [ ] **Step 5: Update `inventory-service/src/services/inventoryService.ts`'s exports for the new stats function**

Append to the copied file:

```ts
export async function getStats(): Promise<{ totalEntities: number; totalRecords: number }> {
  const [totalEntities, totalRecords] = await Promise.all([
    prisma.inventoryEntity.count(),
    prisma.inventoryRecord.count(),
  ]);
  return { totalEntities, totalRecords };
}
```

- [ ] **Step 6: Write `inventory-service/src/controllers/inventoryController.ts`**

Copy `backend/src/controllers/inventoryController.ts` to `inventory-service/src/controllers/inventoryController.ts`, change the audit import line from:

```ts
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';
```

to:

```ts
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditClient';
```

add `getStats` to the `inventoryService` import list, and append a new handler at the end of the file:

```ts
export async function getStatsHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await getStats());
}
```

- [ ] **Step 7: Write `inventory-service/src/routes/inventoryRoutes.ts`**

Copy `backend/src/routes/inventoryRoutes.ts` to `inventory-service/src/routes/inventoryRoutes.ts`, add `getStatsHandler` to the controller import list, and add one new route (placed before `/entities/:id` so it isn't shadowed):

```ts
inventoryRouter.get('/stats', requirePermission('inventory:view'), getStatsHandler);
```

(insert this line directly after `inventoryRouter.use(requireAuth);`)

- [ ] **Step 8: Write `inventory-service/src/app.ts`**

```ts
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { inventoryRouter } from './routes/inventoryRoutes';
import { errorHandler } from './middleware/errorHandler';

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

  app.use('/api/inventory', inventoryRouter);

  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 9: Typecheck**

```bash
cd inventory-service && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add inventory-service/src
git commit -m "feat(inventory-service): add application code with JWT-only auth and stats endpoint"
```

---

### Task 7: `inventory-service` tests

**Files:**
- Create: `inventory-service/tests/inventory.test.ts`, `inventory-credentials.test.ts` (adapted from `backend/tests/`)
- Create: `inventory-service/tests/localFilesystemStorageProvider.test.ts`, `secretCrypto.test.ts` (copies)

**Interfaces:**
- Consumes: `inventory-service`'s app (Task 6). Tests build their own JWT cookies directly (via `signAccessToken`-equivalent logic duplicated inline, or a small test helper) instead of calling a live `auth-service` login — `inventory-service`'s tests never depend on another service being up, per spec §9.

- [ ] **Step 1: Copy the two files that need no changes**

```bash
mkdir -p inventory-service/tests
cp backend/tests/localFilesystemStorageProvider.test.ts inventory-service/tests/localFilesystemStorageProvider.test.ts
cp backend/tests/secretCrypto.test.ts inventory-service/tests/secretCrypto.test.ts
```

- [ ] **Step 2: Write a shared test helper for building an auth cookie without a live `auth-service`**

Create `inventory-service/tests/testAuth.ts`:

```ts
import jwt from 'jsonwebtoken';

export function makeAccessCookie(overrides: {
  sub: string;
  roleId?: string;
  roleName?: string;
  permissions: string[];
}): string {
  const token = jwt.sign(
    {
      sub: overrides.sub,
      roleId: overrides.roleId ?? 'test-role',
      roleName: overrides.roleName ?? 'TestRole',
      permissions: overrides.permissions,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' },
  );
  return `access_token=${token}`;
}
```

This directly mirrors what `auth-service` would put in the cookie, without requiring `auth-service` to be running — `inventory-service`'s test suite is fully self-contained, matching spec §9.

- [ ] **Step 3: Write `inventory-service/tests/inventory.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { makeAccessCookie } from './testAuth';

const app = createApp();
const ADMIN_ID = 'admin-test-id';
const OPERATOR_ID = 'operator-test-id';
const VIEWER_ID = 'viewer-test-id';

const ADMIN_COOKIE = makeAccessCookie({
  sub: ADMIN_ID,
  permissions: ['inventory:view', 'inventory:create', 'inventory:manage', 'inventory:credential:reveal'],
});
const OPERATOR_COOKIE = makeAccessCookie({
  sub: OPERATOR_ID,
  permissions: ['inventory:view', 'inventory:manage', 'inventory:credential:reveal'],
});
const VIEWER_COOKIE = makeAccessCookie({ sub: VIEWER_ID, permissions: ['inventory:view'] });

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
  let entityId: string;

  afterAll(async () => {
    await prisma.inventoryEntity.deleteMany({ where: { name: 'Network Devices' } });
    await prisma.$disconnect();
  });

  it('rejects a non-admin creating an inventory entity', async () => {
    const res = await request(app)
      .post('/api/inventory/entities')
      .set('Cookie', OPERATOR_COOKIE)
      .send({ name: 'Network Devices', fields: NETWORK_DEVICE_FIELDS });
    expect(res.status).toBe(403);
  });

  it('lets an admin create an entity with fields', async () => {
    const res = await request(app)
      .post('/api/inventory/entities')
      .set('Cookie', ADMIN_COOKIE)
      .send({ name: 'Network Devices', fields: NETWORK_DEVICE_FIELDS });
    expect(res.status).toBe(201);
    expect(res.body.fields).toHaveLength(3);
    entityId = res.body.id;
  });

  it('lets a viewer list entities and records but not create a record', async () => {
    const entitiesRes = await request(app).get('/api/inventory/entities').set('Cookie', VIEWER_COOKIE);
    expect(entitiesRes.status).toBe(200);

    const recordsRes = await request(app)
      .get(`/api/inventory/entities/${entityId}/records`)
      .set('Cookie', VIEWER_COOKIE);
    expect(recordsRes.status).toBe(200);

    const createRes = await request(app)
      .post(`/api/inventory/entities/${entityId}/records`)
      .set('Cookie', VIEWER_COOKIE)
      .send({ data: { hostname: 'sw-01', status: 'Active' } });
    expect(createRes.status).toBe(403);
  });

  it('rejects a record missing a required field', async () => {
    const res = await request(app)
      .post(`/api/inventory/entities/${entityId}/records`)
      .set('Cookie', OPERATOR_COOKIE)
      .send({ data: { hostname: 'sw-01' } });
    expect(res.status).toBe(400);
  });

  it('lets an operator create a valid record and then delete it', async () => {
    const createRes = await request(app)
      .post(`/api/inventory/entities/${entityId}/records`)
      .set('Cookie', OPERATOR_COOKIE)
      .send({ data: { hostname: 'sw-01', status: 'Active', portCount: 48 } });
    expect(createRes.status).toBe(201);

    const deleteRes = await request(app)
      .delete(`/api/inventory/records/${createRes.body.id}`)
      .set('Cookie', OPERATOR_COOKIE);
    expect(deleteRes.status).toBe(204);
  });

  it('returns entity/record counts from GET /api/inventory/stats', async () => {
    const res = await request(app).get('/api/inventory/stats').set('Cookie', VIEWER_COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.totalEntities).toBeGreaterThanOrEqual(1);
  });

  it('rejects requests with no cookie at all', async () => {
    const res = await request(app).get('/api/inventory/entities');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 4: Write `inventory-service/tests/inventory-credentials.test.ts`**

Same content as `backend/tests/inventory-credentials.test.ts`, with every `adminAgent`/`operatorAgent`/`viewerAgent` (built via `loginAs`/`createTestUser` against a live `auth-service`) replaced by plain `request(app).<method>(...).set('Cookie', ADMIN_COOKIE)` calls using the same `makeAccessCookie` helper from Step 2, and every audit-log assertion (`GET /api/audit-logs`, `CREDENTIAL_VIEWED` check) replaced by asserting on a mocked `global.fetch` call, matching the pattern in Task 4's `users.test.ts`. Add at the top of the file:

```ts
beforeAll(() => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
});

afterAll(() => {
  jest.restoreAllMocks();
});
```

and replace the one audit-log-reveal assertion (`reveals a password field only for permitted roles, and audit-logs it`) with:

```ts
it('reveals a password field only for permitted roles, and POSTs a CREDENTIAL_VIEWED event to audit-service', async () => {
  const createRes = await request(app)
    .post(`/api/inventory/entities/${windowsEntityId}/records`)
    .set('Cookie', OPERATOR_COOKIE)
    .send({ data: { hostname: 'win-02', username: 'Administrator', password: 'RevealMe123!' } });
  const recordId = createRes.body.id;

  const forbidden = await request(app)
    .get(`/api/inventory/records/${recordId}/fields/password/reveal`)
    .set('Cookie', VIEWER_COOKIE);
  expect(forbidden.status).toBe(403);

  const revealed = await request(app)
    .get(`/api/inventory/records/${recordId}/fields/password/reveal`)
    .set('Cookie', ADMIN_COOKIE);
  expect(revealed.status).toBe(200);
  expect(revealed.body).toEqual({ fieldType: 'PASSWORD', value: 'RevealMe123!' });

  const fetchMock = global.fetch as jest.Mock;
  const auditCall = fetchMock.mock.calls.find(([, init]) => {
    const body = JSON.parse((init as RequestInit).body as string);
    return body.action === 'CREDENTIAL_VIEWED' && body.resourceId === recordId;
  });
  expect(auditCall).toBeDefined();
});
```

- [ ] **Step 5: Run the full `inventory-service` suite**

```bash
cd inventory-service && npx jest --runInBand
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit && npx eslint src tests --ext .ts
```

- [ ] **Step 7: Commit**

```bash
git add inventory-service/tests
git commit -m "test(inventory-service): add self-contained tests using a local JWT cookie helper"
```

---

## Phase 3 — `audit-service`

### Task 8: Scaffold `audit-service`, Prisma schema, and application code

**Files:**
- Create: `audit-service/package.json`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.js`, `jest.setup.js`, `.eslintrc.cjs`, `Dockerfile`, `.env`, `.gitignore`, `certs/extra-ca.pem`
- Create: `audit-service/prisma/schema.prisma`
- Create: `audit-service/src/lib/prisma.ts` (copy)
- Create: `audit-service/src/middleware/requireAuth.ts`, `requirePermission.ts` (same JWT-only versions as `inventory-service`)
- Create: `audit-service/src/middleware/errorHandler.ts` (trimmed, no multer)
- Create: `audit-service/src/schemas/auditSchemas.ts` (copy)
- Create: `audit-service/src/services/auditService.ts` (modified — adds a write function)
- Create: `audit-service/src/controllers/auditController.ts` (modified — adds the internal write handler)
- Create: `audit-service/src/routes/auditRoutes.ts` (modified — adds the internal route, unauthenticated)
- Create: `audit-service/src/app.ts`, `index.ts`

**Interfaces:**
- Consumes: `AccessTokenPayload` via shared `JWT_SECRET` (public route only); `LogAuditInput` shape identical to `auth-service`/`inventory-service`'s `auditClient.ts` (Tasks 3, 6).
- Produces: `GET /api/audit-logs` (existing, `audit:view`-gated), `POST /internal/audit-logs` (new, unauthenticated — reachable only inside the docker network).

- [ ] **Step 1: Scaffold config files**

```bash
mkdir -p audit-service/certs audit-service/prisma audit-service/src/lib audit-service/src/middleware audit-service/src/schemas audit-service/src/services audit-service/src/controllers audit-service/src/routes
cp backend/certs/extra-ca.pem audit-service/certs/extra-ca.pem
cp backend/.eslintrc.cjs audit-service/.eslintrc.cjs
cp backend/tsconfig.json audit-service/tsconfig.json
cp backend/tsconfig.build.json audit-service/tsconfig.build.json
cp backend/jest.setup.js audit-service/jest.setup.js
cp backend/src/lib/prisma.ts audit-service/src/lib/prisma.ts
cp backend/src/schemas/auditSchemas.ts audit-service/src/schemas/auditSchemas.ts
cp backend/src/index.ts audit-service/src/index.ts
```

- [ ] **Step 2: Write `audit-service/package.json`**

```json
{
  "name": "audit-service",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "lint": "eslint src tests --ext .ts",
    "test": "jest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@prisma/client": "^5.19.1",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.7",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.14.9",
    "@types/supertest": "^6.0.2",
    "@typescript-eslint/eslint-plugin": "^7.16.1",
    "@typescript-eslint/parser": "^7.16.1",
    "dotenv": "^18.0.2",
    "eslint": "^8.57.0",
    "jest": "^29.7.0",
    "prettier": "^3.3.3",
    "prisma": "^5.19.1",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.4",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 3: Write `audit-service/jest.config.js`** (same pattern as the other two services)

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  maxWorkers: 1,
};
```

- [ ] **Step 4: Write `audit-service/Dockerfile`** (port `4003`)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY certs/ ./certs/
RUN touch ./certs/extra-ca.pem \
    && cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/certs ./certs
RUN cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./package.json
EXPOSE 4003
CMD ["node", "dist/index.js"]
```

- [ ] **Step 5: Write `audit-service/.gitignore`**

```
node_modules/
dist/
.env
```

- [ ] **Step 6: Write `audit-service/.env`**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/audit_db?schema=public
PORT=4003
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=change-me-32-chars-minimum-please
```

- [ ] **Step 7: Write `audit-service/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model AuditLog {
  id           String   @id @default(uuid())
  userId       String?
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

(`user User? @relation(...)` is gone — `userId` is a plain nullable `String`, per spec §3.)

- [ ] **Step 8: Write `audit-service/src/middleware/requireAuth.ts`** (identical to `inventory-service`'s — copy it verbatim)

```bash
cp inventory-service/src/middleware/requireAuth.ts audit-service/src/middleware/requireAuth.ts
cp inventory-service/src/middleware/requirePermission.ts audit-service/src/middleware/requirePermission.ts
```

- [ ] **Step 9: Write `audit-service/src/middleware/errorHandler.ts`** (trimmed, no multer — copy `auth-service`'s version)

```bash
cp auth-service/src/middleware/errorHandler.ts audit-service/src/middleware/errorHandler.ts
```

- [ ] **Step 10: Write `audit-service/src/services/auditService.ts`**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ListAuditLogsQuery } from '../schemas/auditSchemas';

export interface WriteAuditLogInput {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
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
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}
```

(`listAuditLogs` drops the `include: { user: { select: ... } }` — `User` isn't in this database anymore. Rows now carry a bare `userId`; the frontend resolves display names via `auth-service`'s `/api/users/lookup`, per spec §5.)

- [ ] **Step 11: Write `audit-service/src/controllers/auditController.ts`**

```ts
import { Request, Response } from 'express';
import { listAuditLogsQuerySchema } from '../schemas/auditSchemas';
import { listAuditLogs, writeAuditLog } from '../services/auditService';

export async function listAuditLogsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await listAuditLogs(parsed.data));
}

export async function writeAuditLogHandler(req: Request, res: Response): Promise<void> {
  const { userId, action, resourceType, resourceId, ipAddress, userAgent, metadata } = req.body ?? {};
  if (typeof action !== 'string' || typeof resourceType !== 'string') {
    res.status(400).json({ error: 'action and resourceType are required' });
    return;
  }
  await writeAuditLog({ userId, action, resourceType, resourceId, ipAddress, userAgent, metadata });
  res.status(201).json({ success: true });
}
```

- [ ] **Step 12: Write `audit-service/src/routes/auditRoutes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { listAuditLogsHandler, writeAuditLogHandler } from '../controllers/auditController';

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.get('/', requirePermission('audit:view'), listAuditLogsHandler);

// Deliberately separate from auditRouter (no requireAuth): this is a
// service-to-service write endpoint called by auth-service/inventory-service,
// not a user-facing route. It's only reachable inside the docker network
// (never exposed through the nginx gateway — see Task 10).
export const internalAuditRouter = Router();
internalAuditRouter.post('/', writeAuditLogHandler);
```

- [ ] **Step 13: Write `audit-service/src/app.ts`**

```ts
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { auditRouter, internalAuditRouter } from './routes/auditRoutes';
import { errorHandler } from './middleware/errorHandler';

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

  app.use('/api/audit-logs', auditRouter);
  app.use('/internal/audit-logs', internalAuditRouter);

  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 14: Install dependencies, create the database, and migrate**

```bash
cd audit-service && npm install
docker compose exec postgres psql -U postgres -c "CREATE DATABASE audit_db;"
npx prisma migrate dev --name init
```

- [ ] **Step 15: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 16: Commit**

```bash
git add audit-service
git commit -m "feat(audit-service): scaffold project, Prisma schema, and application code"
```

---

### Task 9: `audit-service` tests

**Files:**
- Create: `audit-service/tests/audit.test.ts`

**Interfaces:**
- Consumes: `audit-service`'s app (Task 8), the JWT cookie helper pattern from Task 7.

- [ ] **Step 1: Copy the JWT cookie test helper**

```bash
mkdir -p audit-service/tests
cp inventory-service/tests/testAuth.ts audit-service/tests/testAuth.ts
```

- [ ] **Step 2: Write `audit-service/tests/audit.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { makeAccessCookie } from './testAuth';

const app = createApp();
const ADMIN_COOKIE = makeAccessCookie({ sub: 'admin-test-id', permissions: ['audit:view'] });
const NO_PERMISSION_COOKIE = makeAccessCookie({ sub: 'no-perm-test-id', permissions: [] });

describe('audit-service', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects unauthenticated requests to GET /api/audit-logs', async () => {
    const res = await request(app).get('/api/audit-logs');
    expect(res.status).toBe(401);
  });

  it('rejects a user without audit:view', async () => {
    const res = await request(app).get('/api/audit-logs').set('Cookie', NO_PERMISSION_COOKIE);
    expect(res.status).toBe(403);
  });

  it('accepts an internal write with no auth and makes it queryable', async () => {
    const writeRes = await request(app).post('/internal/audit-logs').send({
      userId: 'user-abc',
      action: 'LOGIN',
      resourceType: 'User',
      resourceId: 'user-abc',
      ipAddress: '127.0.0.1',
    });
    expect(writeRes.status).toBe(201);

    const listRes = await request(app)
      .get('/api/audit-logs')
      .set('Cookie', ADMIN_COOKIE)
      .query({ action: 'LOGIN' });
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((l: { resourceId: string }) => l.resourceId === 'user-abc')).toBe(true);
    expect(listRes.body.data[0]).not.toHaveProperty('user');
  });

  it('rejects an internal write missing required fields', async () => {
    const res = await request(app).post('/internal/audit-logs').send({ action: 'LOGIN' });
    expect(res.status).toBe(400);
  });

  it('supports pagination', async () => {
    const res = await request(app)
      .get('/api/audit-logs')
      .set('Cookie', ADMIN_COOKIE)
      .query({ page: 1, pageSize: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run the suite**

```bash
cd audit-service && npx jest --runInBand
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit && npx eslint src tests --ext .ts
```

- [ ] **Step 5: Commit**

```bash
git add audit-service/tests
git commit -m "test(audit-service): cover public list endpoint, permission gating, and internal write"
```

---

## Phase 4 — Gateway, compose, and frontend

### Task 10: nginx gateway and `docker-compose.yml` rewrite

**Files:**
- Create: `nginx/nginx.conf`
- Modify: `docker-compose.yml` (full rewrite)

**Interfaces:**
- Produces: a single entry point on `http://localhost:8080` routing to the three services by path, per spec §6.

- [ ] **Step 1: Write `nginx/nginx.conf`**

```nginx
server {
  listen 80;

  location /api/auth/ {
    proxy_pass http://auth-service:4001;
    proxy_set_header Host $host;
  }
  location /api/users/ {
    proxy_pass http://auth-service:4001;
    proxy_set_header Host $host;
  }
  location /api/roles/ {
    proxy_pass http://auth-service:4001;
    proxy_set_header Host $host;
  }
  location /api/inventory/ {
    proxy_pass http://inventory-service:4002;
    proxy_set_header Host $host;
    client_max_body_size 1m;
  }
  location /api/audit-logs/ {
    proxy_pass http://audit-service:4003;
    proxy_set_header Host $host;
  }
}
```

(`client_max_body_size 1m` on the inventory route only — that's the one path that receives file uploads, matching the existing `multer` limits of 64KB per file plus form overhead.)

- [ ] **Step 2: Write `docker-compose.yml`**

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

  auth-service:
    build: ./auth-service
    environment:
      DATABASE_URL: ${AUTH_DATABASE_URL}
      PORT: 4001
      CORS_ORIGIN: ${CORS_ORIGIN}
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_INITIAL_PASSWORD: ${ADMIN_INITIAL_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4001/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  inventory-service:
    build: ./inventory-service
    environment:
      DATABASE_URL: ${INVENTORY_DATABASE_URL}
      PORT: 4002
      CORS_ORIGIN: ${CORS_ORIGIN}
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      KEY_STORAGE_PATH: ${KEY_STORAGE_PATH}
      AUDIT_SERVICE_URL: http://audit-service:4003
    volumes:
      - key-storage:/app/key-storage
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4002/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  audit-service:
    build: ./audit-service
    environment:
      DATABASE_URL: ${AUDIT_DATABASE_URL}
      PORT: 4003
      CORS_ORIGIN: ${CORS_ORIGIN}
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4003/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  gateway:
    image: nginx:1.27-alpine
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "8080:80"
    depends_on:
      auth-service:
        condition: service_healthy
      inventory-service:
        condition: service_healthy
      audit-service:
        condition: service_healthy

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    ports:
      - "3000:3000"
    depends_on:
      - gateway

volumes:
  postgres-data:
  key-storage:
```

(None of the three backend services publish a host port anymore — only `gateway` and `frontend` do. This matches the point of the gateway: it's the only thing anything outside the docker network talks to.)

- [ ] **Step 3: Add the three new database URLs and update `NEXT_PUBLIC_API_URL` in `.env`**

Edit the root `.env` (not committed): remove `DATABASE_URL`, `PORT`, `KEY_STORAGE_PATH` (now per-service, hardcoded or set directly in `docker-compose.yml` above) and add:

```
AUTH_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/auth_db?schema=public
INVENTORY_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/inventory_db?schema=public
AUDIT_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/audit_db?schema=public
KEY_STORAGE_PATH=/app/key-storage
NEXT_PUBLIC_API_URL=http://localhost:8080
```

Keep `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `CORS_ORIGIN`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` as they are today. Also update `.env.example` the same way (this file **is** committed).

- [ ] **Step 4: Update the root `.gitignore`** for the new services' test/build directories

Replace:

```
backend/tests/
frontend/tests/
```

with:

```
*/tests/
```

(matches every service's `tests/` directory at the repo root level, including `frontend/tests/` and, until it's deleted in Task 13, `backend/tests/`.)

- [ ] **Step 5: Commit**

```bash
git add nginx docker-compose.yml .env.example .gitignore
git commit -m "feat(infra): add nginx gateway and rewrite docker-compose for 3 services"
```

(The root `.env` itself is gitignored — update it locally but there's nothing to commit for it.)

---

### Task 11: Frontend changes

**Files:**
- Modify: `frontend/lib/apiClient.ts` (401-retry-once-after-refresh)
- Modify: `frontend/types/dashboard.ts`, `frontend/app/(app)/dashboard/page.tsx` (call two services instead of one)
- Modify: `frontend/types/auditLog.ts`, `frontend/app/(app)/audit-logs/page.tsx` (resolve `userId` via the new lookup endpoint)

**Interfaces:**
- Consumes: `GET /api/inventory/stats`, `GET /api/users/count`, `GET /api/users/lookup?ids=...`, `POST /api/auth/refresh` (all from Phases 1–3).

- [ ] **Step 1: Update `frontend/lib/apiClient.ts`**

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
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

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = rawFetch('/api/auth/refresh', { method: 'POST' })
      .then((res) => res.ok)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// inventory-service and audit-service verify JWTs locally and can't silently
// refresh an expired access token the way auth-service still can (it has
// direct DB access). When either returns 401, retry once after asking
// auth-service to mint a fresh access token from the still-valid refresh
// cookie.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await rawFetch(path, init);
  if (res.status !== 401 || path === '/api/auth/refresh' || path === '/api/auth/login') {
    return res;
  }
  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    return res;
  }
  return rawFetch(path, init);
}
```

- [ ] **Step 2: Update `frontend/types/dashboard.ts`**

```ts
export interface DashboardStats {
  totalEntities: number;
  totalRecords: number;
  totalUsers: number;
}
```

(unchanged shape from before the split — only where the numbers come from changes.)

- [ ] **Step 3: Update `frontend/app/(app)/dashboard/page.tsx`**

Replace the `useQuery` block:

```tsx
const { data, isLoading, isError } = useQuery<DashboardStats>({
  queryKey: ['dashboard'],
  queryFn: async () => {
    const res = await apiFetch('/api/dashboard');
    if (!res.ok) throw new Error('Failed to load dashboard');
    return res.json();
  },
});
```

with:

```tsx
const { data, isLoading, isError } = useQuery<DashboardStats>({
  queryKey: ['dashboard'],
  queryFn: async () => {
    const [statsRes, usersRes] = await Promise.all([
      apiFetch('/api/inventory/stats'),
      apiFetch('/api/users/count'),
    ]);
    if (!statsRes.ok || !usersRes.ok) throw new Error('Failed to load dashboard');
    const stats = await statsRes.json();
    const users = await usersRes.json();
    return { totalEntities: stats.totalEntities, totalRecords: stats.totalRecords, totalUsers: users.totalUsers };
  },
});
```

The rest of the file (the three `StatCard`s) is already correct from the earlier inventory-credential-fields work and needs no further change.

- [ ] **Step 4: Update `frontend/types/auditLog.ts`**

```ts
export interface AuditLogEntry {
  id: string;
  userId: string | null;
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

- [ ] **Step 5: Update `frontend/app/(app)/audit-logs/page.tsx`**

Add a second query that resolves display names for the distinct `userId`s on the current page, and use it in the table:

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { apiFetch } from '@/lib/apiClient';
import type { PaginatedAuditLogs } from '@/types/auditLog';

interface UserLookupEntry {
  id: string;
  name: string;
  email: string;
}

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

  const userIds = Array.from(new Set((data?.data ?? []).map((e) => e.userId).filter((id): id is string => Boolean(id))));

  const { data: userLookup } = useQuery<UserLookupEntry[]>({
    queryKey: ['user-lookup', userIds],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/lookup?ids=${userIds.join(',')}`);
      if (!res.ok) throw new Error('Failed to resolve users');
      return res.json();
    },
    enabled: userIds.length > 0,
  });

  const userById = new Map((userLookup ?? []).map((u) => [u.id, u]));

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Audit Logs</h1>

      <Input
        placeholder="Filter by action (e.g. INVENTORY_RECORD_CREATED)"
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-sm font-mono"
      />

      {isLoading && <p className="text-slate-500">Loading audit logs...</p>}
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
                <TableCell>{entry.userId ? (userById.get(entry.userId)?.email ?? entry.userId) : 'Unknown'}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-1 font-mono text-xs font-medium text-indigo-700">
                    {entry.action}
                  </span>
                </TableCell>
                <TableCell>
                  {entry.resourceType}
                  {entry.metadata && Object.keys(entry.metadata).length > 0
                    ? ` (${Object.values(entry.metadata).join(', ')})`
                    : ''}
                </TableCell>
                <TableCell className="font-mono text-xs">{entry.ipAddress ?? '—'}</TableCell>
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

- [ ] **Step 6: Typecheck, lint, and build**

```bash
cd frontend && npx tsc --noEmit && npx eslint . --ext .ts,.tsx && rm -rf .next && npx next build
```

Expected: no errors, build succeeds.

- [ ] **Step 7: Run the frontend test suite**

```bash
npx vitest run
```

Expected: all existing tests still pass (none of them assert on `AuditLogEntry.user` or exercise the dashboard's fetch internals directly).

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/apiClient.ts frontend/types/dashboard.ts "frontend/app/(app)/dashboard/page.tsx" frontend/types/auditLog.ts "frontend/app/(app)/audit-logs/page.tsx"
git commit -m "feat(frontend): compose dashboard stats from 2 services, resolve audit log users via lookup, retry once on 401"
```

---

### Task 12: Full stack live verification

**Files:** none (verification only)

- [ ] **Step 1: Stop the old `backend`/`frontend` containers**

```bash
docker compose stop backend frontend 2>/dev/null || true
```

(This may no-op or error harmlessly if `backend`'s compose service definition is already gone from `docker-compose.yml` after Task 10 — that's fine, the goal is just to make sure nothing from the old topology is still running.)

- [ ] **Step 2: Build and start the full new stack**

```bash
docker compose build auth-service inventory-service audit-service gateway frontend
docker compose up -d postgres auth-service inventory-service audit-service gateway frontend
```

- [ ] **Step 3: Confirm every service is healthy**

```bash
docker compose ps
```

Expected: `postgres`, `auth-service`, `inventory-service`, `audit-service` all show `healthy`; `gateway` and `frontend` show `Up`.

- [ ] **Step 4: Confirm the gateway routes correctly**

```bash
curl -s http://localhost:8080/api/auth/me -o /dev/null -w "auth: %{http_code}\n"
curl -s http://localhost:8080/api/inventory/entities -o /dev/null -w "inventory: %{http_code}\n"
curl -s http://localhost:8080/api/audit-logs -o /dev/null -w "audit: %{http_code}\n"
```

Expected: all three return `401` (no cookie) — proving the gateway reached the right service (a wrong route or a down service would instead return `502`/`504`/`404`).

- [ ] **Step 5: Live browser walkthrough**

Using chrome-devtools-mcp (or manual testing) against `http://localhost:3000` (frontend still on its own port, talking to the gateway on `8080`):
1. Log in as Admin.
2. Confirm the Dashboard loads with correct counts (composed from two services now).
3. Create an inventory entity, add a record, delete it.
4. Create a record with an SSH key / a password field, reveal it.
5. Open Audit Logs — confirm entries show resolved user emails (not raw IDs), proving the lookup endpoint works.
6. Wait past 15 minutes (or temporarily lower `ACCESS_TOKEN_TTL` to `10s` in `auth-service`'s `tokenService.ts` for this check only, then revert) and confirm a subsequent Inventory or Audit Logs page load still works without forcing a re-login — proving the 401-retry-refresh path in `apiClient.ts` works end-to-end. Revert any temporary TTL change before committing anything further.

- [ ] **Step 6: Fix anything found, then re-run Steps 2–5**

If any step fails, fix the root cause in the relevant service/task above — don't work around it in the gateway or frontend unless the bug is genuinely there.

---

## Phase 5 — Cutover

### Task 13: Delete `backend/`

**Files:**
- Delete: the entire `backend/` directory

**Interfaces:** none.

- [ ] **Step 1: Confirm nothing outside `backend/` still references it**

```bash
grep -rn "'\.\./backend\|\"\.\./backend\|backend/src\|backend/prisma" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.json" . 2>/dev/null | grep -v node_modules | grep -v "^\./backend/"
```

Expected: no matches (the gateway/compose/frontend changes in Task 10–11 never referenced `backend/` paths).

- [ ] **Step 2: Delete it**

```bash
rm -rf backend
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove backend/ now that auth/inventory/audit services replace it"
```

---

### Task 14: Final regression and finish

**Files:** none (verification only)

- [ ] **Step 1: Run every service's test suite**

```bash
cd auth-service && npx jest --runInBand && npx tsc --noEmit && npx eslint src tests --ext .ts
cd ../inventory-service && npx jest --runInBand && npx tsc --noEmit && npx eslint src tests --ext .ts
cd ../audit-service && npx jest --runInBand && npx tsc --noEmit && npx eslint src tests --ext .ts
cd ../frontend && npx vitest run && npx tsc --noEmit && npx eslint . --ext .ts,.tsx && rm -rf .next && npx next build
```

Expected: everything passes.

- [ ] **Step 2: Rebuild and redeploy the full stack one more time**

```bash
cd .. && docker compose build && docker compose up -d
docker compose ps
```

Expected: all 6 services (`postgres`, `auth-service`, `inventory-service`, `audit-service`, `gateway`, `frontend`) healthy/up.

- [ ] **Step 3: Repeat the live browser walkthrough from Task 12, Step 5**

Confirm everything still works against the final, `backend/`-free state.

- [ ] **Step 4: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work," then follow that skill (verify tests, present merge/PR/keep options, execute the chosen option).
