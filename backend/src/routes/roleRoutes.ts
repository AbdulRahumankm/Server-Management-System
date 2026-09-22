import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import { listRolesHandler } from '../controllers/userController';

export const roleRouter = Router();

roleRouter.use(requireAuth);
roleRouter.get('/', requirePermission('role:manage'), listRolesHandler);
