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
