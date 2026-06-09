import { Router } from 'express';
import { createQrOrder, getQrMenu } from '../controllers/publicQrController';

const router = Router();

router.get('/qr-menu/:tenantId', getQrMenu);
router.post('/qr-orders', createQrOrder);

export default router;
