import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { listAuditLogsHandler, writeAuditLogHandler } from '../controllers/auditController';

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.get('/', requirePermission('audit:view'), listAuditLogsHandler);

// Deliberately separate from auditRouter (no requireAuth): this is a
// service-to-service write endpoint called by auth-service/inventory-service,
// not a user-facing route. It's only reachable inside the docker network
// (never exposed through the nginx gateway).
export const internalAuditRouter = Router();
internalAuditRouter.post('/', writeAuditLogHandler);
