import { Router } from 'express';
import {
	createProduct,
	deleteProduct,
	listProducts,
	getProduct,
	updateProductBranch,
	uploadProductImage,
} from '../controllers/productController';
import { authMiddleware } from '../middlewares/authMiddleware';
import multer from 'multer';

const router = Router();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 4 * 1024 * 1024,
	},
});

router.use(authMiddleware);

router.get('/', listProducts);
router.post('/', createProduct);
router.get('/:productId', getProduct);
router.post('/:id/image', upload.single('file'), uploadProductImage);
router.patch('/:id', updateProductBranch);
router.delete('/:id', deleteProduct);

export default router;
