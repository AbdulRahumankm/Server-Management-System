import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listServersHandler,
  getServerHandler,
  createServerHandler,
  updateServerHandler,
  deleteServerHandler,
  getServerCredentialHandler,
} from '../controllers/serverController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 },
});

export const serverRouter = Router();

serverRouter.use(requireAuth);

serverRouter.get('/', requirePermission('server:view'), listServersHandler);
serverRouter.post(
  '/',
  requirePermission('server:create'),
  upload.single('credentialFile'),
  createServerHandler,
);
serverRouter.get('/:id', requirePermission('server:view'), getServerHandler);
serverRouter.get(
  '/:id/credential',
  requirePermission('key:download'),
  getServerCredentialHandler,
);
serverRouter.put('/:id', requirePermission('server:edit'), updateServerHandler);
serverRouter.delete('/:id', requirePermission('server:delete'), deleteServerHandler);
