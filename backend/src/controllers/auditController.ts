import { Request, Response } from 'express';
import { listAuditLogsQuerySchema } from '../schemas/auditSchemas';
import { listAuditLogs } from '../services/auditService';

export async function listAuditLogsHandler(req: Request, res: Response): Promise<void> {
  const parsed = listAuditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await listAuditLogs(parsed.data));
}
