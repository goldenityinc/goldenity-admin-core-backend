import { Router, Request, Response, NextFunction } from 'express';
import {
  registerDevice,
  deviceHeartbeat,
  listBranchDevices,
  getDefaultPrinterDevice,
} from '../controllers/deviceController';
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

router.post('/register', flexibleAuth, ensureTenantContext, registerDevice);
router.post('/:uuid/heartbeat', flexibleAuth, ensureTenantContext, deviceHeartbeat);

router.use(authMiddleware);
router.use(tenantMiddleware);
router.get('/branch/:branchId', listBranchDevices);
router.get('/branch/:branchId/default-printer', getDefaultPrinterDevice);
router.get('/branches/:branchId/devices', listBranchDevices);
router.get('/branches/:branchId/devices/default-printer', getDefaultPrinterDevice);

export default router;
