import type { Request } from 'express';

export const AUDIT_ACTIONS = {
  INVENTORY_CREATED: 'INVENTORY_CREATED',
  INVENTORY_UPDATED: 'INVENTORY_UPDATED',
  INVENTORY_RECORD_CREATED: 'INVENTORY_RECORD_CREATED',
  INVENTORY_RECORD_DELETED: 'INVENTORY_RECORD_DELETED',
  INVENTORY_RECORDS_IMPORTED: 'INVENTORY_RECORDS_IMPORTED',
  CREDENTIAL_VIEWED: 'CREDENTIAL_VIEWED',
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
  try {
    const res = await fetch(`${process.env.AUDIT_SERVICE_URL}/internal/audit-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      console.warn('audit log write failed (non-fatal):', res.status);
    }
  } catch (err) {
    console.warn('audit log write failed (non-fatal):', err);
  }
}
