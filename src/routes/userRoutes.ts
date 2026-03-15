import { Router } from 'express';
import {
	createUser,
	deleteUserHard,
	getUsers,
	resetUserPassword,
	syncPosUsers,
	updateUserStatus,
} from '../controllers/userController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';
import { login } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.use(authMiddleware);
router.get('/', roleMiddleware('SUPER_ADMIN'), getUsers);
router.post('/', roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN', 'OWNER'), createUser);
router.post('/sync-pos', roleMiddleware('SUPER_ADMIN'), syncPosUsers);
router.patch('/:id/reset-password', roleMiddleware('SUPER_ADMIN'), resetUserPassword);
router.patch('/:id/status', roleMiddleware('SUPER_ADMIN'), updateUserStatus);
router.delete('/:id', roleMiddleware('SUPER_ADMIN'), deleteUserHard);

export default router;
