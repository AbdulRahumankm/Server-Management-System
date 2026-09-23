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

const FAKE_KEY = Buffer.from(
  '-----BEGIN OPENSSH PRIVATE KEY-----\nnotarealkey\n-----END OPENSSH PRIVATE KEY-----\n',
);

describe('keys', () => {
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
    await prisma.server.updateMany({ data: { assignedKeyId: null } });
    await prisma.sSHKey.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['operator@example.com', 'viewer@example.com'] } },
    });
    await prisma.$disconnect();
  });

  it('lets an operator upload a key but never exposes storageRef/iv/authTag', async () => {
    const res = await operatorAgent
      .post('/api/keys')
      .field('name', 'ci-deploy-key')
      .field('keyType', 'ed25519')
      .attach('file', FAKE_KEY, 'id_ed25519');

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('storageRef');
    expect(res.body).not.toHaveProperty('iv');
    expect(res.body).not.toHaveProperty('authTag');
    expect(res.body.name).toBe('ci-deploy-key');
  });

  it('rejects a file that does not look like a private key', async () => {
    const res = await operatorAgent
      .post('/api/keys')
      .field('name', 'not-a-key')
      .field('keyType', 'rsa')
      .attach('file', Buffer.from('just some text'), 'not-a-key.txt');

    expect(res.status).toBe(400);
  });

  it('lets a viewer list and view key metadata but not upload', async () => {
    const listRes = await viewerAgent.get('/api/keys');
    expect(listRes.status).toBe(200);
    expect(listRes.body[0]).not.toHaveProperty('storageRef');

    const uploadRes = await viewerAgent
      .post('/api/keys')
      .field('name', 'viewer-attempt')
      .field('keyType', 'rsa')
      .attach('file', FAKE_KEY, 'id_rsa');
    expect(uploadRes.status).toBe(403);
  });

  it('never lets a viewer download a private key', async () => {
    const list = await adminAgent.get('/api/keys');
    const keyId = list.body.find((k: { name: string }) => k.name === 'ci-deploy-key').id;

    const res = await viewerAgent.get(`/api/keys/${keyId}/download`);
    expect(res.status).toBe(403);
  });

  it('lets an admin download the decrypted key content as a file, not JSON', async () => {
    const list = await adminAgent.get('/api/keys');
    const keyId = list.body.find((k: { name: string }) => k.name === 'ci-deploy-key').id;

    const res = await adminAgent.get(`/api/keys/${keyId}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(Buffer.from(res.body).equals(FAKE_KEY)).toBe(true);
  });

  it("lets an operator assign a key to a server, but admin cannot per this project's permission model", async () => {
    const server = await prisma.server.create({
      data: {
        hostname: 'assign-target.internal',
        ipAddress: '10.0.0.9',
        os: 'LINUX',
        environment: 'PRODUCTION',
        application: 'web',
        owner: 'Platform Team',
        username: 'deploy',
        createdById: (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id,
      },
    });
    const list = await adminAgent.get('/api/keys');
    const keyId = list.body.find((k: { name: string }) => k.name === 'ci-deploy-key').id;

    const adminAttempt = await adminAgent.post(`/api/keys/${keyId}/assign`).send({ serverId: server.id });
    expect(adminAttempt.status).toBe(403);

    const operatorAttempt = await operatorAgent
      .post(`/api/keys/${keyId}/assign`)
      .send({ serverId: server.id });
    expect(operatorAttempt.status).toBe(200);
    expect(operatorAttempt.body.assignedKey.id).toBe(keyId);
  });

  it('lets an admin delete a key', async () => {
    const created = await adminAgent
      .post('/api/keys')
      .field('name', 'to-delete')
      .field('keyType', 'rsa')
      .attach('file', FAKE_KEY, 'id_rsa');

    const res = await adminAgent.delete(`/api/keys/${created.body.id}`);
    expect(res.status).toBe(204);

    const getRes = await adminAgent.get(`/api/keys/${created.body.id}`);
    expect(getRes.status).toBe(404);
  });
});
