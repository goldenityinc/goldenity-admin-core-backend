import { Router } from 'express';
import {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  voidExpense,
} from '../controllers/expenseController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', listExpenses);
router.post('/', createExpense);
router.get('/:id', getExpense);
router.put('/:id', updateExpense);
router.patch('/:id/void', voidExpense);

export default router;
