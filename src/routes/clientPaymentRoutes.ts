import { Router } from 'express';
import multer from 'multer';
import {
  listMatrix,
  listReferences,
  getCell,
  upsertCell,
  deleteCell,
} from '../controllers/clientPaymentController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);

router.get('/matrix', listMatrix);
router.get('/references', listReferences);
router.get('/:id', getCell);
router.put('/cell', upload.array('receipt_images', 10), upsertCell);
router.delete('/cell', deleteCell);

export default router;
