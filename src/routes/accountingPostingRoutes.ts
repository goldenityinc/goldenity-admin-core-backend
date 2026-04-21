import { Router } from 'express';
import {
  autoPostExpenseJournal,
  autoPostSalesJournal,
} from '../controllers/accountingPostingController';
import { internalServiceAuth } from '../middlewares/internalServiceAuth';

const router = Router();

router.use(internalServiceAuth);
router.post('/sales', autoPostSalesJournal);
router.post('/expenses', autoPostExpenseJournal);

export default router;