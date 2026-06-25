import { Router } from 'express';
import {
  createExpense,
  listExpenses,
  getExpense,
  updateExpense,
  voidExpense,
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
router.post('/', upload.single('attachment'), createExpense);
router.get('/:id', getExpense);
router.put('/:id', upload.single('attachment'), updateExpense);
router.patch('/:id/void', voidExpense);

export default router;
