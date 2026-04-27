import { Router } from 'express';
import { createSale } from '../controllers/salesController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.post('/', createSale);

export default router;