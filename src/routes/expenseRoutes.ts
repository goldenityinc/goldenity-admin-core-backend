import { Router } from 'express';
import {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  voidExpense,
  setPaymentStatus,
} from '../controllers/expenseController';
import { authMiddleware } from '../middlewares/authMiddleware';
import multer from 'multer';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.use(authMiddleware);

router.get('/', listExpenses);
router.post('/', upload.array('attachments', 10), createExpense);
router.get('/:id', getExpense);
router.put('/:id', upload.array('attachments', 10), updateExpense);
router.patch('/:id/void', voidExpense);
router.patch('/:id/payment-status', setPaymentStatus);

export default router;
