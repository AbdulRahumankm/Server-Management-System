import { prisma } from '../lib/prisma';

export async function getDashboardStats() {
  const [totalEntities, totalRecords, totalUsers] = await Promise.all([
    prisma.inventoryEntity.count(),
    prisma.inventoryRecord.count(),
    prisma.user.count(),
  ]);

  return { totalEntities, totalRecords, totalUsers };
}
