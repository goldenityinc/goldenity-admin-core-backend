import { Router } from 'express';
import { login, me } from '../controllers/authController';
import { verifyToken } from '../middlewares/authMiddleware';

const router = Router();

router.post('/login', login);
// Backward compatibility for older clients.
router.post('/login-tenant', login);
router.get('/me', verifyToken, me);

export default router;