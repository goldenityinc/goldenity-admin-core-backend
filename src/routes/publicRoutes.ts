import { Router } from 'express';
import { getTenantLogoPublic } from '../controllers/tenantController';

const router = Router();

// Public endpoints (no auth)
router.get('/tenants/:tenantId/logo', getTenantLogoPublic);

export default router;
