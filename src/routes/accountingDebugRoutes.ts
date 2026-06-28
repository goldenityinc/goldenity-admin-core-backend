import { Router } from 'express';
import { resetLedgerDebug } from '../controllers/accountingDebugController';
import {
  authMiddleware,
  roleMiddleware,
  tenantMiddleware,
} from '../middlewares/authMiddleware';

const router = Router();

router.use(
  authMiddleware,
  tenantMiddleware,
  roleMiddleware('OWNER', 'ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN', 'MANAGER'),
);

router.post('/reset-ledger', resetLedgerDebug);

export default router;
