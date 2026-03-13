import { Router } from 'express';
import { createUser, getUsers, resetUserPassword, syncPosUsers } from '../controllers/userController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';
import { login } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.use(authMiddleware);
router.get('/', roleMiddleware('SUPER_ADMIN'), getUsers);
router.post('/', roleMiddleware('SUPER_ADMIN'), createUser);
router.post('/sync-pos', roleMiddleware('SUPER_ADMIN'), syncPosUsers);
router.patch('/:id/reset-password', roleMiddleware('SUPER_ADMIN'), resetUserPassword);

export default router;
