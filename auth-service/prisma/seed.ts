import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const PERMISSIONS = [
  'user:manage',
  'role:manage',
  'inventory:create',
  'inventory:manage',
  'inventory:view',
  'inventory:credential:reveal',
  'audit:view',
] as const;

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  Admin: [
    'user:manage',
    'role:manage',
    'inventory:view',
    'inventory:create',
    'inventory:manage',
    'inventory:credential:reveal',
    'audit:view',
  ],
  Operator: [
    'inventory:view',
    'inventory:manage',
    'inventory:credential:reveal',
    'audit:view',
  ],
  Viewer: ['inventory:view', 'audit:view'],
};

export async function seed(prisma: PrismaClient): Promise<void> {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const key of permissionKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Admin' } });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Initial Admin',
      passwordHash: await hash(adminPassword),
      roleId: adminRole.id,
    },
  });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
