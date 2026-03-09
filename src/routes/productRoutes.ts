import { Router } from 'express';
import { getProducts, createProduct } from '../controllers/productController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Semua route di sini memerlukan autentikasi
router.use(authMiddleware);

/**
 * @route   GET /api/products
 * @desc    Get all products for current tenant
 * @access  Private (All authenticated users)
 */
router.get('/', getProducts);

/**
 * @route   POST /api/products
 * @desc    Create new product
 * @access  Private (TENANT_ADMIN, SUPER_ADMIN only)
 */
router.post('/', roleMiddleware('TENANT_ADMIN', 'SUPER_ADMIN'), createProduct);

export default router;
