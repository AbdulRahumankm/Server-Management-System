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
