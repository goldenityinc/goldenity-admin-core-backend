import { Router } from 'express';
import {
	createSale,
	getPreOrdersSummary,
	listCustomers,
	listPreOrders,
} from '../controllers/salesController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.get('/pre-orders', listPreOrders);
router.get('/pre-orders/summary', getPreOrdersSummary);
router.get('/customers', listCustomers);
router.post('/', createSale);

export default router;