import { Request, Response } from 'express';
import { getDashboardStats } from '../services/dashboardService';

export async function getDashboardStatsHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await getDashboardStats());
}
