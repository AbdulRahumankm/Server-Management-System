import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ListAuditLogsQuery } from '../schemas/auditSchemas';

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  SERVER_CREATED: 'SERVER_CREATED',
  SERVER_UPDATED: 'SERVER_UPDATED',
  SERVER_DELETED: 'SERVER_DELETED',
  KEY_UPLOADED: 'KEY_UPLOADED',
  KEY_DOWNLOADED: 'KEY_DOWNLOADED',
  KEY_DELETED: 'KEY_DELETED',
  KEY_ASSIGNED: 'KEY_ASSIGNED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface LogAuditInput {
  userId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export function requestContext(req: Request): { ipAddress: string; userAgent?: string } {
  return {
    ipAddress: req.ip ?? 'unknown',
    userAgent: req.get('user-agent') ?? undefined,
  };
}

export async function logAudit(input: LogAuditInput): Promise<void> {
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
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}
