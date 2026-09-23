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

  it('rejects a non-operator bulk-importing records', async () => {
    const res = await viewerAgent
      .post(`/api/inventory/entities/${entityId}/records/bulk`)
      .send({ records: [{ hostname: 'sw-10', status: 'Active' }] });
    expect(res.status).toBe(403);
  });

  it('bulk-imports valid rows and reports per-row errors for invalid ones', async () => {
    const res = await operatorAgent
      .post(`/api/inventory/entities/${entityId}/records/bulk`)
      .send({
        records: [
          { hostname: 'sw-20', status: 'Active', portCount: 24 },
          { hostname: 'sw-21' },
          { hostname: 'sw-22', status: 'NotAnOption' },
          { hostname: 'sw-23', status: 'Retired' },
        ],
      });

    expect(res.status).toBe(207);
    expect(res.body.insertedCount).toBe(2);
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.errors[0].row).toBe(2);
    expect(res.body.errors[1].row).toBe(3);

    const listRes = await operatorAgent.get(`/api/inventory/entities/${entityId}/records`);
    const hostnames = listRes.body.data.map((r: { data: { hostname: string } }) => r.data.hostname);
    expect(hostnames).toEqual(expect.arrayContaining(['sw-20', 'sw-23']));
    expect(hostnames).not.toContain('sw-21');
    expect(hostnames).not.toContain('sw-22');
  });

  it('rejects a bulk import for a non-existent entity', async () => {
    const res = await operatorAgent
      .post('/api/inventory/entities/00000000-0000-0000-0000-000000000000/records/bulk')
      .send({ records: [{ hostname: 'sw-30', status: 'Active' }] });
    expect(res.status).toBe(404);
  });

  it('rejects an empty records array', async () => {
    const res = await operatorAgent
      .post(`/api/inventory/entities/${entityId}/records/bulk`)
      .send({ records: [] });
    expect(res.status).toBe(400);
  });
});
