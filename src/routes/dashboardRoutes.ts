import { Router } from 'express';
import { DashboardController } from '../controllers/dashboardController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @route   GET /api/dashboard/metrics
 * @desc    Get dashboard metrics (total tenants, active users, system health)
 * @access  SUPER_ADMIN only
 */
router.get(
  '/metrics',
  authMiddleware,
  roleMiddleware('SUPER_ADMIN'),
  DashboardController.getMetrics
);

export default router;
