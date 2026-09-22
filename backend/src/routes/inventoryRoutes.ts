import { Router } from 'express';
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
  updateRecordHandler,
  deleteRecordHandler,
} from '../controllers/inventoryController';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/entities', requirePermission('inventory:view'), listEntitiesHandler);
inventoryRouter.post('/entities', requirePermission('inventory:create'), createEntityHandler);
inventoryRouter.get('/entities/:id', requirePermission('inventory:view'), getEntityHandler);
inventoryRouter.put('/entities/:id', requirePermission('inventory:manage'), updateEntityHandler);
inventoryRouter.delete('/entities/:id', requirePermission('inventory:manage'), deleteEntityHandler);
inventoryRouter.get('/entities/:id/records', requirePermission('inventory:view'), listRecordsHandler);
inventoryRouter.post(
  '/entities/:id/records',
  requirePermission('inventory:manage'),
  createRecordHandler,
);
inventoryRouter.put('/records/:id', requirePermission('inventory:manage'), updateRecordHandler);
inventoryRouter.delete('/records/:id', requirePermission('inventory:manage'), deleteRecordHandler);
