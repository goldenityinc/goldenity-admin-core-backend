import type { Request, Response, NextFunction } from 'express';
import { DashboardService } from '../services/dashboardService';

/**
 * GET /api/dashboard/metrics
 * Get dashboard metrics for control plane:
 * - totalTenants
 * - activeSubscriptions
 * - subscriptionsBySolution
 */
export async function getMetrics(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const metrics = await DashboardService.getDashboardMetrics();

    res.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    next(error);
  }
}

export const DashboardController = {
  getMetrics,
};
