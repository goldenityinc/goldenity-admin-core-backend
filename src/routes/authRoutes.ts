import { Router } from 'express';
import {
  changePassword,
	getEntitlements,
	getSubscription,
	login,
	logout,
	me,
	verify,
} from '../controllers/authController';
import { authMiddleware, roleMiddleware, verifyToken } from '../middlewares/authMiddleware';
import { adminLogin, adminMe } from '../controllers/adminAuthController';

const router = Router();

// Portal Super Admin (pengganti login Firebase).
router.post('/admin/login', adminLogin);
router.get('/admin/me', authMiddleware, roleMiddleware('SUPER_ADMIN'), adminMe);

router.post('/login', login);
// Backward compatibility for older clients.
router.post('/login-tenant', login);
router.post('/verify', verify);
router.get('/me', verifyToken, me);
router.get('/tenant/status', verifyToken, me);
router.put('/change-password', verifyToken, changePassword);
router.post('/logout', verifyToken, logout);
router.get('/subscription', verifyToken, getSubscription);
router.get('/entitlements', verifyToken, getEntitlements);

export default router;