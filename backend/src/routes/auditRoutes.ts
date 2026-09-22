import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { listAuditLogsHandler } from '../controllers/auditController';

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.get('/', requirePermission('audit:view'), listAuditLogsHandler);
