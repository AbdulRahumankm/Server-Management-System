import type { Request } from 'express';

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
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
