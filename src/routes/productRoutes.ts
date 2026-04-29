import { Router } from 'express';
import { listProducts, getProduct, updateProductBranch } from '../controllers/productController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', listProducts);
router.get('/:productId', getProduct);
router.patch('/:id', updateProductBranch);

export default router;
