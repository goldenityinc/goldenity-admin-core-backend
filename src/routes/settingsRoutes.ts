import { Router } from 'express';
import { changeSuperAdminPassword } from '../controllers/settingsController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.put('/change-password', roleMiddleware('SUPER_ADMIN'), changeSuperAdminPassword);

export default router;
