import { Router } from 'express';
import {
	createUser,
	deleteUserHard,
	getUsers,
	resetUserPassword,
	syncPosUsers,
	updateUserRole,
	updateUserStatus,
} from '../controllers/userController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';
import { login } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.use(authMiddleware);
router.get('/', roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN', 'OWNER'), getUsers);
router.post('/', roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN', 'OWNER'), createUser);
router.post('/sync-pos', roleMiddleware('SUPER_ADMIN'), syncPosUsers);
router.patch('/:id', roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN', 'OWNER'), updateUserRole);
router.patch('/:id/reset-password', roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN', 'OWNER'), resetUserPassword);
router.patch('/:id/status', roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN', 'OWNER'), updateUserStatus);
router.delete('/:id', roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'ADMIN', 'OWNER'), deleteUserHard);

export default router;
