import { Router } from 'express';
import { getTenantLogoPublic } from '../controllers/tenantController';
import { serveImage } from '../controllers/imageProxyController';

const router = Router();

// Public endpoints (no auth)
router.get('/tenants/:tenantId/logo', getTenantLogoPublic);

// Image proxy endpoint (public, no auth required)
// Pattern: GET /images/:encodedKey
router.get('/images/:encodedKey', serveImage);

export default router;
