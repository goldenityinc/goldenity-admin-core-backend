import { Router } from 'express';
import { createUser, getUsers, resetUserPassword } from '../controllers/userController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.get('/', roleMiddleware('SUPER_ADMIN'), getUsers);
router.post('/', roleMiddleware('SUPER_ADMIN'), createUser);
router.patch('/:id/reset-password', roleMiddleware('SUPER_ADMIN'), resetUserPassword);

export default router;
