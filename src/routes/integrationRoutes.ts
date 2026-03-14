import { Router } from 'express';
import { provisionErp } from '../controllers/integrationController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Only SUPER_ADMIN can provision integrated apps.
router.use(authMiddleware);
router.use(roleMiddleware('SUPER_ADMIN'));

// 1-click provisioning: create ERP org, set CRM→ERP tenant mapping, optionally apply features.
router.post('/erp/provision', provisionErp);

export default router;
