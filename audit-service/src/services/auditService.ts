import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ListAuditLogsQuery } from '../schemas/auditSchemas';

export interface WriteAuditLogInput {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? undefined,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? undefined,
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function listAuditLogs(query: ListAuditLogsQuery) {
  const where: Prisma.AuditLogWhereInput = {};
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.userId) where.userId = query.userId;

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}
