import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { getDashboardStatsHandler } from '../controllers/dashboardController';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get('/', getDashboardStatsHandler);
