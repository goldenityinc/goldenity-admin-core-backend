import { Router } from 'express';
import { listProducts, getProduct } from '../controllers/productController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', listProducts);
router.get('/:productId', getProduct);

export default router;
