import { Router } from 'express';
import { listTransactions, getTransaction } from '../controllers/transactionController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', listTransactions);
router.get('/:id', getTransaction);

export default router;
