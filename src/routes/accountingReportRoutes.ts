import { Router } from 'express';
import {
  getBalanceSheetReport,
  getProfitAndLossReport,
} from '../controllers/accountingReportController';
import { authMiddleware, tenantMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware, tenantMiddleware);
router.get('/profit-loss', getProfitAndLossReport);
router.get('/balance-sheet', getBalanceSheetReport);

export default router;