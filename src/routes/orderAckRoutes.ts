import { Router, Request, Response, NextFunction } from 'express';
import {
  acknowledgeOrder,
  getOrderAckStatus,
} from '../controllers/orderAckController';
import { authMiddleware, tenantMiddleware } from '../middlewares/authMiddleware';
import { internalServiceAuth } from '../middlewares/internalServiceAuth';

const router = Router({ mergeParams: true });

function flexibleAuth(req: Request, res: Response, next: NextFunction) {
  const internalToken = (req.headers['x-internal-token'] || '').toString().trim();
  if (internalToken) {
    return internalServiceAuth(req, res, next);
  }
  return authMiddleware(req, res, next);
}

function ensureTenantContext(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.tenantId) {
    return tenantMiddleware(req, _res, next);
  }
  return next();
}

router.post('/:id/ack', flexibleAuth, ensureTenantContext, acknowledgeOrder);
router.post('/:id/acknowledge', flexibleAuth, ensureTenantContext, acknowledgeOrder);

router.use(authMiddleware);
router.use(tenantMiddleware);
router.get('/:id/ack-status', getOrderAckStatus);

export default router;
