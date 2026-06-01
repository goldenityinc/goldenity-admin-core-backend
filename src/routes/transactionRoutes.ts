import { Router } from 'express';
import { listTransactions, getTransaction, cancelTransaction } from '../controllers/transactionController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', listTransactions);
router.get('/:id', getTransaction);
router.patch('/:id/cancel', cancelTransaction);

export default router;

