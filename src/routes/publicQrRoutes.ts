import { Router } from 'express';
import multer from 'multer';
import { createQrOrder, getQrMenu, uploadQrOrderPayment } from '../controllers/publicQrController';

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const router = Router();

router.get('/qr-menu/:tenantId', getQrMenu);
router.post('/qr-orders', createQrOrder);
router.put(
  '/qr-orders/:id/payment',
  proofUpload.fields([
    { name: 'payment_proof', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'proof', maxCount: 1 },
    { name: 'paymentProof', maxCount: 1 },
  ]),
  uploadQrOrderPayment,
);
router.put(
  '/qr-orders/:orderId/payment',
  proofUpload.fields([
    { name: 'payment_proof', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'proof', maxCount: 1 },
    { name: 'paymentProof', maxCount: 1 },
  ]),
  uploadQrOrderPayment,
);

export default router;
