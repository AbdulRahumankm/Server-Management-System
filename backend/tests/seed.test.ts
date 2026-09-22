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

    expect(admin?.permissions.length).toBe(14);
    expect(operator?.permissions.length).toBe(9);
    expect(viewer?.permissions.length).toBe(4);
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
