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
