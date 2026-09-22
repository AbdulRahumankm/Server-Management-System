import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listKeysHandler,
  getKeyHandler,
  uploadKeyHandler,
  downloadKeyHandler,
  deleteKeyHandler,
  assignKeyHandler,
} from '../controllers/keyController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 },
});

export const keyRouter = Router();

keyRouter.use(requireAuth);

keyRouter.get('/', requirePermission('key:view'), listKeysHandler);
keyRouter.post('/', requirePermission('key:upload'), upload.single('file'), uploadKeyHandler);
keyRouter.get('/:id', requirePermission('key:view'), getKeyHandler);
keyRouter.get('/:id/download', requirePermission('key:download'), downloadKeyHandler);
keyRouter.delete('/:id', requirePermission('key:delete'), deleteKeyHandler);
keyRouter.post('/:id/assign', requirePermission('key:assign'), assignKeyHandler);
