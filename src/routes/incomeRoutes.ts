import { Router } from 'express';
import {
  createIncome,
  listIncomes,
  getIncome,
  updateIncome,
  voidIncome,
  setPaymentStatus,
  deleteIncome,
} from '../controllers/incomeController';
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

router.get('/', listIncomes);
router.post('/', upload.array('attachments', 10), createIncome);
router.get('/:id', getIncome);
router.put('/:id', upload.array('attachments', 10), updateIncome);
router.delete('/:id', deleteIncome);
router.patch('/:id/void', voidIncome);
router.patch('/:id/payment-status', setPaymentStatus);

export default router;
