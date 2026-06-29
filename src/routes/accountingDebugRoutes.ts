import { Router } from 'express';
import {
  rebuildLedgerDebug,
  resetLedgerDebug,
} from '../controllers/accountingDebugController';
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
router.post('/rebuild-ledger', rebuildLedgerDebug);

export default router;
