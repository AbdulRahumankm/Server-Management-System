# Authentication + RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local email/password authentication with httpOnly-cookie JWTs (access + refresh, with transparent refresh-on-expiry), Express middleware that enforces RBAC on every protected route, and a frontend login page + route guard — this is Phase 3 of the overall system.

**Architecture:** Backend follows Routes → Controllers → Services → Prisma. `passwordService`/`tokenService` are pure, unit-testable wrappers around `@node-rs/argon2`/`jsonwebtoken`; `authService` is the only place that touches Prisma for auth; `requireAuth`/`requirePermission` are composable Express middleware later routes (servers, keys, inventory, users, audit) will import as-is. Frontend gets a client-side login form and a Next.js `middleware.ts` that redirects unauthenticated users away from protected paths — a UX convenience only, since the backend independently enforces auth/permissions on every request.

**Tech Stack:** `@node-rs/argon2`, `jsonwebtoken`, `express-rate-limit`, `zod` (backend, already installed in Phase 1); `react-hook-form` + `@hookform/resolvers/zod` (frontend, already installed in Phase 1).

**Spec:** [docs/superpowers/specs/2026-09-22-server-inventory-platform-design.md](../specs/2026-09-22-server-inventory-platform-design.md) — see §5 Authentication and §6 RBAC.

## Global Constraints

- TypeScript strict mode in both apps.
- JWTs live only in httpOnly/secure(prod)/sameSite=lax cookies, never in a JSON response body.
- Backend is the sole source of truth for auth/permissions — the frontend's `middleware.ts` redirect is UX only.
- Rate limiting required on `/api/auth/login` (spec §19).
- No audit logging in this plan — Phase 6 (Audit Logging) revisits this phase's endpoints to add `AuditLog` writes for login/logout, per the spec's own phase order.
- Every new backend file follows Routes → Controllers → Services → Prisma; no Prisma calls inside a route handler or controller.

---

## File Structure

```
backend/src/
├── lib/
│   └── prisma.ts                    # PrismaClient singleton
├── services/
│   ├── passwordService.ts           # hashPassword/verifyPassword
│   ├── tokenService.ts              # sign/verify access+refresh JWTs
│   └── authService.ts               # authenticate(), getUserById()
├── middleware/
│   ├── requireAuth.ts               # cookie verification + transparent refresh
│   ├── requirePermission.ts         # RBAC gate
│   └── errorHandler.ts              # centralized error responses
├── controllers/
│   └── authController? -- not needed: routes are thin enough to be the controller layer here (see Task 6 note)
└── routes/
    └── authRoutes.ts

backend/tests/
├── passwordService.test.ts
├── tokenService.test.ts
├── requirePermission.test.ts
└── auth.test.ts                     # integration: supertest + real Postgres

frontend/
├── lib/apiClient.ts                  # fetch wrapper, credentials: 'include'
├── app/login/page.tsx
├── app/dashboard/page.tsx            # stub; Phase 8 builds the real dashboard
├── middleware.ts                     # redirect-if-unauthenticated (UX only)
└── tests/login.test.tsx
```

---

### Task 1: Prisma client singleton

**Files:**
- Create: `backend/src/lib/prisma.ts`

**Interfaces:**
- Consumes: `PrismaClient` from `@prisma/client` (Phase 2).
- Produces: `prisma` — every later service imports this singleton rather than constructing its own `PrismaClient`.

- [ ] **Step 1: Create `backend/src/lib/prisma.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

- [ ] **Step 2: Typecheck**

Run (from `backend/`): `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/prisma.ts
git commit -m "feat(backend): add Prisma client singleton"
```

---

### Task 2: Password hashing service

**Files:**
- Create: `backend/src/services/passwordService.ts`
- Test: `backend/tests/passwordService.test.ts`

**Interfaces:**
- Consumes: `hash`/`verify` from `@node-rs/argon2`.
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(passwordHash: string, plain: string): Promise<boolean>` — `authService` (Task 4) and the Phase 1 seed script both standardize on these names going forward (the seed script currently calls `@node-rs/argon2`'s `hash` directly; leave it as-is, it predates this service and doesn't need to change).

- [ ] **Step 1: Write the failing test**

```ts
import { hashPassword, verifyPassword } from '../src/services/passwordService';

describe('passwordService', () => {
  it('hashes and verifies a password round-trip', async () => {
    const hash = await hashPassword('correct-horse');
    expect(hash).not.toBe('correct-horse');
    expect(await verifyPassword(hash, 'correct-horse')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `npx jest tests/passwordService.test.ts`
Expected: FAIL — `Cannot find module '../src/services/passwordService'`

- [ ] **Step 3: Implement**

```ts
import { hash, verify } from '@node-rs/argon2';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  return verify(passwordHash, plain);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/passwordService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/passwordService.ts backend/tests/passwordService.test.ts
git commit -m "feat(backend): add password hashing service"
```

---

### Task 3: JWT token service

**Files:**
- Create: `backend/src/services/tokenService.ts`
- Test: `backend/tests/tokenService.test.ts`

**Interfaces:**
- Consumes: `JWT_SECRET`, `JWT_REFRESH_SECRET` env vars (present since Phase 1's `.env`/`.env.example`).
- Produces: `AccessTokenPayload { sub: string; roleId: string }`, `signAccessToken(payload): string`, `signRefreshToken(payload): string`, `verifyAccessToken(token): AccessTokenPayload`, `verifyRefreshToken(token): AccessTokenPayload` — `requireAuth` (Task 5) and `authRoutes` (Task 6) both import these exact names.

- [ ] **Step 1: Write the failing test**

```ts
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../src/services/tokenService';

describe('tokenService', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken({ sub: 'user-1', roleId: 'role-1' });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.roleId).toBe('role-1');
  });

  it('signs and verifies a refresh token', () => {
    const token = signRefreshToken({ sub: 'user-1', roleId: 'role-1' });
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-1');
  });

  it('rejects a tampered access token', () => {
    const token = signAccessToken({ sub: 'user-1', roleId: 'role-1' });
    expect(() => verifyAccessToken(`${token}tampered`)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/tokenService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
import jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  sub: string;
  roleId: string;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/tokenService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tokenService.ts backend/tests/tokenService.test.ts
git commit -m "feat(backend): add JWT token service"
```

---

### Task 4: Auth service (Prisma-backed)

**Files:**
- Create: `backend/src/services/authService.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `verifyPassword` (Task 2).
- Produces: `AuthenticatedUser { id, email, name, role: { id, name, permissions: string[] } }`, `InvalidCredentialsError`, `authenticate(email, password): Promise<AuthenticatedUser>`, `getUserById(id): Promise<AuthenticatedUser | null>` — `requireAuth` and `authRoutes` (Tasks 5, 6) both consume this shape; `permissions` is a flat array of `Permission.key` strings (e.g. `"server:view"`), matching the seed script's keys from Phase 1.

- [ ] **Step 1: Implement**

No test file for this task in isolation — Task 6's `auth.test.ts` integration test exercises it end-to-end against a real seeded database, which is a stronger guarantee than mocking Prisma here.

```ts
import { prisma } from '../lib/prisma';
import { verifyPassword } from './passwordService';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: {
    id: string;
    name: string;
    permissions: string[];
  };
}

export class InvalidCredentialsError extends Error {}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  name: string;
  role: { id: string; name: string; permissions: { permission: { key: string } }[] };
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: {
      id: user.role.id,
      name: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
    },
  };
}

const USER_WITH_ROLE_INCLUDE = {
  role: { include: { permissions: { include: { permission: true } } } },
} as const;

export async function authenticate(email: string, password: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: USER_WITH_ROLE_INCLUDE,
  });

  if (!user || !user.passwordHash) {
    throw new InvalidCredentialsError();
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    throw new InvalidCredentialsError();
  }

  return toAuthenticatedUser(user);
}

export async function getUserById(userId: string): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: USER_WITH_ROLE_INCLUDE,
  });
  return user ? toAuthenticatedUser(user) : null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/authService.ts
git commit -m "feat(backend): add Prisma-backed auth service"
```

---

### Task 5: `requireAuth` and `requirePermission` middleware

**Files:**
- Create: `backend/src/middleware/requireAuth.ts`
- Create: `backend/src/middleware/requirePermission.ts`
- Test: `backend/tests/requirePermission.test.ts`

**Interfaces:**
- Consumes: `verifyAccessToken`, `verifyRefreshToken`, `signAccessToken` (Task 3), `getUserById`, `AuthenticatedUser` (Task 4).
- Produces: `req.user?: AuthenticatedUser` (Express `Request` augmentation), `requireAuth` middleware, `requirePermission(key: string)` middleware factory, and the cookie-name/option constants `ACCESS_COOKIE`, `REFRESH_COOKIE`, `setAccessCookie(res, token)` — Task 6's routes reuse these exact exports rather than re-declaring cookie names, so a future rename only happens in one place.

- [ ] **Step 1: Create `backend/src/middleware/requireAuth.ts`**

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
      setAccessCookie(res, signAccessToken({ sub: user.id, roleId: user.role.id }));
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

- [ ] **Step 2: Write the failing test for `requirePermission`**

```ts
import type { Request, Response } from 'express';
import { requirePermission } from '../src/middleware/requirePermission';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('requirePermission', () => {
  it('calls next when the user has the permission', () => {
    const req = { user: { role: { permissions: ['server:view'] } } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requirePermission('server:view')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when the user lacks the permission', () => {
    const req = { user: { role: { permissions: [] } } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requirePermission('server:delete')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no authenticated user', () => {
    const req = {} as Request;
    const res = mockRes();
    const next = jest.fn();

    requirePermission('server:view')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/requirePermission.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Create `backend/src/middleware/requirePermission.ts`**

```ts
import { Request, Response, NextFunction } from 'express';

export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.user.role.permissions.includes(permissionKey)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/requirePermission.test.ts`
Expected: PASS — 3 passed

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0

- [ ] **Step 7: Commit**

```bash
git add backend/src/middleware/requireAuth.ts backend/src/middleware/requirePermission.ts backend/tests/requirePermission.test.ts
git commit -m "feat(backend): add requireAuth and requirePermission middleware"
```

---

### Task 6: Auth routes, rate limiting, centralized error handler, wire into app

**Files:**
- Create: `backend/src/middleware/errorHandler.ts`
- Create: `backend/src/routes/authRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/auth.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `InvalidCredentialsError` (Task 4); `signAccessToken`, `signRefreshToken` (Task 3); `requireAuth`, `setAccessCookie`, `ACCESS_COOKIE`, `REFRESH_COOKIE` (Task 5); `createApp` (Phase 1).
- Produces: `authRouter` mounted at `/api/auth` inside `createApp()` — later phases (servers, keys, inventory, users, audit) mount their own routers the same way, alongside this one.

There's no separate `authController.ts` — the route handlers below are the whole controller layer for auth (three small handlers with no branching complex enough to warrant splitting out); this matches "don't add abstractions the task doesn't need." If a later auth feature needs real controller logic, split it out then.

- [ ] **Step 1: Create `backend/src/middleware/errorHandler.ts`**

```ts
import { Request, Response, NextFunction } from 'express';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 2: Create `backend/src/routes/authRoutes.ts`**

```ts
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, InvalidCredentialsError } from '../services/authService';
import { signAccessToken, signRefreshToken } from '../services/tokenService';
import {
  requireAuth,
  setAccessCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../middleware/requireAuth';

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

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    setAccessCookie(res, signAccessToken({ sub: user.id, roleId: user.role.id }));
    res.cookie(REFRESH_COOKIE, signRefreshToken({ sub: user.id, roleId: user.role.id }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
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

authRouter.post('/logout', (_req: Request, res: Response) => {
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
```

- [ ] **Step 3: Wire into `backend/src/app.ts`**

Modify the existing file (from Phase 1) to mount the router and the error handler. The full resulting file:

```ts
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/authRoutes';
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

  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 4: Write the integration test — `backend/tests/auth.test.ts`**

This needs a real, migrated, seeded Postgres — see "Verification" below for how to provide one.

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
  });

  afterAll(async () => {
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

- [ ] **Step 5: Provide a real Postgres and run the migration**

Run: `docker run -d --name temp-postgres-auth -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine`
Wait for it to accept connections (`docker exec temp-postgres-auth pg_isready -U postgres`), then from `backend/`: `npx prisma migrate deploy`

- [ ] **Step 6: Run the full backend test suite**

Run: `npm test`
Expected: all suites pass, including `tests/auth.test.ts`

- [ ] **Step 7: Lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: both exit 0

- [ ] **Step 8: Tear down the temporary Postgres**

Run: `docker stop temp-postgres-auth && docker rm temp-postgres-auth`

- [ ] **Step 9: Commit**

```bash
git add backend/src/middleware/errorHandler.ts backend/src/routes/authRoutes.ts backend/src/app.ts backend/tests/auth.test.ts
git commit -m "feat(backend): add auth routes, rate limiting, and centralized error handler"
```

---

### Task 7: Frontend login page and route guard

**Files:**
- Create: `frontend/lib/apiClient.ts`
- Create: `frontend/app/login/page.tsx`
- Create: `frontend/app/dashboard/page.tsx` (stub; Phase 8 replaces the body)
- Create: `frontend/middleware.ts`
- Test: `frontend/tests/login.test.tsx`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_API_URL` env var (Phase 1).
- Produces: `apiFetch(path, init)` — every later frontend data-fetching call (servers, keys, inventory, users, audit) uses this instead of raw `fetch`, so credentials/headers stay consistent in one place.

- [ ] **Step 1: Create `frontend/lib/apiClient.ts`**

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}
```

- [ ] **Step 2: Write the failing test — `frontend/tests/login.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '../app/login/page';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('shows a validation error when submitted empty', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('Sign in'));
    expect(await screen.findByText('Enter a valid email address')).toBeDefined();
  });

  it('redirects to /dashboard on successful login', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'ChangeMe123!' },
    });
    fireEvent.click(screen.getByText('Sign in'));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows a server error message on invalid credentials', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Sign in'));

    expect(await screen.findByText('Invalid email or password')).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run tests/login.test.tsx`
Expected: FAIL — `Cannot find module '../app/login/page'`

- [ ] **Step 4: Create `frontend/app/login/page.tsx`**

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/apiClient';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      setServerError('Invalid email or password');
      return;
    }

    router.push('/dashboard');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <form onSubmit={handleSubmit(onSubmit)} className="flex w-80 flex-col gap-3">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <div>
          <input
            type="email"
            placeholder="Email"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            {...register('email')}
          />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>
        <div>
          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            {...register('password')}
          />
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        </div>
        {serverError && <p className="text-sm text-red-600">{serverError}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/login.test.tsx`
Expected: PASS — 3 passed

- [ ] **Step 6: Create the dashboard stub — `frontend/app/dashboard/page.tsx`**

```tsx
export default function DashboardPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-slate-500">Coming soon.</p>
    </main>
  );
}
```

- [ ] **Step 7: Create `frontend/middleware.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/dashboard'];

export function middleware(request: NextRequest) {
  const isProtected = PROTECTED_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (!isProtected) {
    return NextResponse.next();
  }

  if (!request.cookies.has('access_token')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
```

- [ ] **Step 8: Run full frontend suite, lint, typecheck, build**

Run (from `frontend/`): `npm test && npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass/exit 0

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/apiClient.ts frontend/app/login frontend/app/dashboard frontend/middleware.ts frontend/tests/login.test.tsx
git commit -m "feat(frontend): add login page, route guard, and API client"
```

---

## Self-Review Notes

- **Spec coverage:** §5 Authentication → Tasks 1-6 (local auth, httpOnly cookies, rate limiting, `authProvider`/`providerId` already on the `User` model from Phase 2 so no migration needed here). §6 RBAC → Tasks 5-6 (`requirePermission`, enforced server-side; Viewer's permission set from Phase 1's seed has no `key:download`, matching "Viewer must NOT be able to download private SSH keys" ahead of Phase 5 actually adding that route). Frontend `/login` route (spec §17) → Task 7.
- **Type consistency:** `AuthenticatedUser` (Task 4) is the exact shape `req.user` is typed as (Task 5) and the exact shape `/api/auth/me` serializes from (Task 6). `AccessTokenPayload.sub`/`roleId` (Task 3) match the fields `requireAuth` reads and the fields `authRoutes` passes when signing.
- **No placeholders:** every step has literal file contents or literal commands with expected output. The one deliberately-deferred item (audit logging on login/logout) is called out explicitly in Global Constraints rather than left as a silent gap.
