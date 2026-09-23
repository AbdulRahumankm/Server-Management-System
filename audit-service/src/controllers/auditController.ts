import { Request, Response } from 'express';
import { listAuditLogsQuerySchema } from '../schemas/auditSchemas';
import { listAuditLogs, writeAuditLog } from '../services/auditService';

export async function listAuditLogsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await listAuditLogs(parsed.data));
}

export async function writeAuditLogHandler(req: Request, res: Response): Promise<void> {
  const { userId, action, resourceType, resourceId, ipAddress, userAgent, metadata } = req.body ?? {};
  if (typeof action !== 'string' || typeof resourceType !== 'string') {
    res.status(400).json({ error: 'action and resourceType are required' });
    return;
  }
  await writeAuditLog({ userId, action, resourceType, resourceId, ipAddress, userAgent, metadata });
  res.status(201).json({ success: true });
}
