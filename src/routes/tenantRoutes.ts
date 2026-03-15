import { Router } from 'express';
import { createTenant, getTenants, uploadTenantLogo } from '../controllers/tenantController';
import { createTenantUser, getTenantUsers } from '../controllers/userController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';
import multer from 'multer';

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 2 * 1024 * 1024, // 2MB
	},
});

const router = Router();

// Semua endpoint tenant onboarding wajib token valid.
router.use(authMiddleware);

// Restrict ke SUPER_ADMIN. Saat bootstrap awal, line roleMiddleware bisa dilepas sementara.
router.get('/', roleMiddleware('SUPER_ADMIN'), getTenants);
router.post('/', roleMiddleware('SUPER_ADMIN'), createTenant);
router.post('/:tenantId/logo', roleMiddleware('SUPER_ADMIN'), upload.single('file'), uploadTenantLogo);
router.get('/:tenantId/users', roleMiddleware('SUPER_ADMIN'), getTenantUsers);
router.post('/:tenantId/users', roleMiddleware('SUPER_ADMIN'), createTenantUser);

export default router;
