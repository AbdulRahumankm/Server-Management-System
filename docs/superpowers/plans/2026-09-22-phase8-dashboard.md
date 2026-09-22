# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single `GET /api/dashboard` endpoint returning the exact stats the original request's Dashboard section names, and a real `/dashboard` page replacing Phase 3's placeholder stub. This is Phase 8.

**Architecture:** One `dashboardService.getDashboardStats()` runs all the count queries in parallel (`Promise.all`) plus the 10 most recent audit log entries for "Recent Activities" — a single round trip from the frontend rather than one request per stat card.

**Tech Stack:** No new dependencies.

**Spec:** Original request §4 (Dashboard stat list).

## Global Constraints

- Dashboard access requires only `requireAuth` (no specific permission) — every stat shown is an aggregate count or a list of audit entries, and all three roles already hold `server:view`/`key:view`/`audit:view`, so there's no role that would see the dashboard but be blocked from the underlying data it summarizes.
- No new audit action — viewing the dashboard isn't in the original request's audited-actions list.

---

## File Structure

```
backend/src/
├── services/dashboardService.ts
├── controllers/dashboardController.ts
└── routes/dashboardRoutes.ts
backend/tests/dashboard.test.ts

frontend/
├── types/dashboard.ts
└── app/dashboard/page.tsx            # replaces the Phase 3 stub
```

---

### Task 1: Dashboard service, controller, route, and integration test

**Files:**
- Create: `backend/src/services/dashboardService.ts`
- Create: `backend/src/controllers/dashboardController.ts`
- Create: `backend/src/routes/dashboardRoutes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/tests/dashboard.test.ts`

**Interfaces:**
- Produces: `getDashboardStats()` returning `{ totalServers, linuxServers, windowsServers, productionServers, uatServers, developmentServers, totalKeys, recentActivity }` — `dashboardRouter` mounted at `/api/dashboard`.

- [ ] **Step 1: Create `backend/src/services/dashboardService.ts`**

```ts
import { prisma } from '../lib/prisma';

export async function getDashboardStats() {
  const [
    totalServers,
    linuxServers,
    windowsServers,
    productionServers,
    uatServers,
    developmentServers,
    totalKeys,
    recentActivity,
  ] = await Promise.all([
    prisma.server.count(),
    prisma.server.count({ where: { os: 'LINUX' } }),
    prisma.server.count({ where: { os: 'WINDOWS' } }),
    prisma.server.count({ where: { environment: 'PRODUCTION' } }),
    prisma.server.count({ where: { environment: 'UAT' } }),
    prisma.server.count({ where: { environment: 'DEVELOPMENT' } }),
    prisma.sSHKey.count(),
    prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  return {
    totalServers,
    linuxServers,
    windowsServers,
    productionServers,
    uatServers,
    developmentServers,
    totalKeys,
    recentActivity,
  };
}
```

- [ ] **Step 2: Create `backend/src/controllers/dashboardController.ts`**

```ts
import { Request, Response } from 'express';
import { getDashboardStats } from '../services/dashboardService';

export async function getDashboardStatsHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await getDashboardStats());
}
```

- [ ] **Step 3: Create `backend/src/routes/dashboardRoutes.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { getDashboardStatsHandler } from '../controllers/dashboardController';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get('/', getDashboardStatsHandler);
```

- [ ] **Step 4: Wire into `backend/src/app.ts`**

```ts
import { dashboardRouter } from './routes/dashboardRoutes';
// ...
app.use('/api/inventory', inventoryRouter);
app.use('/api/dashboard', dashboardRouter);
// ...
app.use(errorHandler);
```

- [ ] **Step 5: Write the integration test — `backend/tests/dashboard.test.ts`**

```ts
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { seed } from '../prisma/seed';

const app = createApp();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';

describe('dashboard', () => {
  let adminAgent: ReturnType<typeof request.agent>;
  let serverId: string;

  beforeAll(async () => {
    await seed(prisma);
    adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const createRes = await adminAgent.post('/api/servers').send({
      hostname: 'dashboard-test-01.internal',
      ipAddress: '10.0.0.60',
      os: 'LINUX',
      environment: 'PRODUCTION',
      application: 'dashboard-check',
      owner: 'QA',
      username: 'deploy',
    });
    serverId = createRes.body.id;
  });

  afterAll(async () => {
    await prisma.server.deleteMany({ where: { id: serverId } });
    await prisma.$disconnect();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('returns server/key counts and recent activity for an authenticated user', async () => {
    const res = await adminAgent.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.totalServers).toBeGreaterThanOrEqual(1);
    expect(res.body.linuxServers).toBeGreaterThanOrEqual(1);
    expect(res.body.productionServers).toBeGreaterThanOrEqual(1);
    expect(res.body).toHaveProperty('totalKeys');
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
    expect(res.body.recentActivity.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Provide a real Postgres, migrate, run the full backend suite**

```bash
docker run -d --name temp-postgres-dashboard -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=server_inventory -p 5432:5432 postgres:16-alpine
# wait for pg_isready, then from backend/:
npx prisma migrate deploy
npm test
```

Expected: all suites pass, including `tests/dashboard.test.ts`.

- [ ] **Step 7: Lint, typecheck, tear down Postgres**

```bash
npm run lint && npx tsc --noEmit
docker stop temp-postgres-dashboard && docker rm temp-postgres-dashboard
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/dashboardService.ts backend/src/controllers/dashboardController.ts backend/src/routes/dashboardRoutes.ts backend/src/app.ts backend/tests/dashboard.test.ts
git commit -m "feat(backend): add dashboard stats endpoint"
```

---

### Task 2: Dashboard frontend page

**Files:**
- Create: `frontend/types/dashboard.ts`
- Modify: `frontend/app/dashboard/page.tsx` (replaces the Phase 3 stub)

- [ ] **Step 1: Create `frontend/types/dashboard.ts`**

```ts
export interface DashboardActivity {
  id: string;
  user: { id: string; name: string; email: string } | null;
  action: string;
  resourceType: string;
  createdAt: string;
}

export interface DashboardStats {
  totalServers: number;
  linuxServers: number;
  windowsServers: number;
  productionServers: number;
  uatServers: number;
  developmentServers: number;
  totalKeys: number;
  recentActivity: DashboardActivity[];
}
```

- [ ] **Step 2: Replace `frontend/app/dashboard/page.tsx`**

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiClient';
import type { DashboardStats } from '@/types/dashboard';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await apiFetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard');
      return res.json();
    },
  });

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>

      {isLoading && <p>Loading dashboard...</p>}
      {isError && <p className="text-red-600">Failed to load dashboard.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Total Servers" value={data.totalServers} />
            <StatCard label="Linux Servers" value={data.linuxServers} />
            <StatCard label="Windows Servers" value={data.windowsServers} />
            <StatCard label="Production Servers" value={data.productionServers} />
            <StatCard label="UAT Servers" value={data.uatServers} />
            <StatCard label="Development Servers" value={data.developmentServers} />
            <StatCard label="Total SSH Keys" value={data.totalKeys} />
          </div>

          <section className="mt-8">
            <h2 className="mb-2 text-lg font-medium">Recent Activity</h2>
            <ul className="flex flex-col gap-2">
              {data.recentActivity.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 p-2 text-sm">
                  <span className="font-medium">{entry.user?.email ?? 'Unknown'}</span> — {entry.action}{' '}
                  <span className="text-slate-400">
                    ({new Date(entry.createdAt).toLocaleString()})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
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
git add frontend/types/dashboard.ts frontend/app/dashboard/page.tsx
git commit -m "feat(frontend): build the real dashboard page, replacing the Phase 3 stub"
```

---

## Self-Review Notes

- **Spec coverage:** §4's stat list (Total/Linux/Windows/Production/UAT/Development servers, Total SSH Keys, Recent Activities) → Task 1's `getDashboardStats` return shape maps one-to-one, Task 2's page renders one card per stat.
- **Type consistency:** `DashboardStats`/`DashboardActivity` (Task 2) match `getDashboardStats`'s return shape (Task 1) field-for-field.
- **No placeholders:** every step has literal code or literal commands with expected output.
