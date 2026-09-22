import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listServersHandler,
  getServerHandler,
  createServerHandler,
  updateServerHandler,
  deleteServerHandler,
} from '../controllers/serverController';

export const serverRouter = Router();

serverRouter.use(requireAuth);

serverRouter.get('/', requirePermission('server:view'), listServersHandler);
serverRouter.post('/', requirePermission('server:create'), createServerHandler);
serverRouter.get('/:id', requirePermission('server:view'), getServerHandler);
serverRouter.put('/:id', requirePermission('server:edit'), updateServerHandler);
serverRouter.delete('/:id', requirePermission('server:delete'), deleteServerHandler);
