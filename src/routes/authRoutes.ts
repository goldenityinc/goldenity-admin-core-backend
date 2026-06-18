import { Router } from 'express';
import {
  changePassword,
	getEntitlements,
	getSubscription,
	login,
	me,
} from '../controllers/authController';
import { verifyToken } from '../middlewares/authMiddleware';

const router = Router();

router.post('/login', login);
// Backward compatibility for older clients.
router.post('/login-tenant', login);
router.get('/me', verifyToken, me);
router.put('/change-password', verifyToken, changePassword);
router.get('/subscription', verifyToken, getSubscription);
router.get('/entitlements', verifyToken, getEntitlements);

export default router;