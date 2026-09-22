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
