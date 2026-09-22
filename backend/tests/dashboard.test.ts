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
