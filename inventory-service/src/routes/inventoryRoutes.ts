import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listEntitiesHandler,
  getEntityHandler,
  createEntityHandler,
  updateEntityHandler,
  deleteEntityHandler,
  listRecordsHandler,
  createRecordHandler,
  bulkCreateRecordsHandler,
  updateRecordHandler,
  deleteRecordHandler,
  revealRecordFieldHandler,
  getStatsHandler,
} from '../controllers/inventoryController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 },
});

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/stats', requirePermission('inventory:view'), getStatsHandler);
inventoryRouter.get('/entities', requirePermission('inventory:view'), listEntitiesHandler);
inventoryRouter.post('/entities', requirePermission('inventory:create'), createEntityHandler);
inventoryRouter.get('/entities/:id', requirePermission('inventory:view'), getEntityHandler);
inventoryRouter.put('/entities/:id', requirePermission('inventory:manage'), updateEntityHandler);
inventoryRouter.delete('/entities/:id', requirePermission('inventory:manage'), deleteEntityHandler);
inventoryRouter.get('/entities/:id/records', requirePermission('inventory:view'), listRecordsHandler);
inventoryRouter.post(
  '/entities/:id/records',
  requirePermission('inventory:manage'),
  upload.any(),
  createRecordHandler,
);
inventoryRouter.post(
  '/entities/:id/records/bulk',
  requirePermission('inventory:manage'),
  bulkCreateRecordsHandler,
);
inventoryRouter.put(
  '/records/:id',
  requirePermission('inventory:manage'),
  upload.any(),
  updateRecordHandler,
);
inventoryRouter.delete('/records/:id', requirePermission('inventory:manage'), deleteRecordHandler);
inventoryRouter.get(
  '/records/:id/fields/:fieldName/reveal',
  requirePermission('inventory:credential:reveal'),
  revealRecordFieldHandler,
);
