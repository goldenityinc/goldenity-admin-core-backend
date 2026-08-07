import { Router } from 'express';
import {
  getOrdersByTransactionCode,
  getRelayOrderById,
  relayFlexibleAuth,
} from '../controllers/relayOrdersController';

const router = Router({ mergeParams: true });

router.use(relayFlexibleAuth);

// 🔴 CRITICAL FIX: query order by STRING TRANSACTION CODE (receipt_number/reference_id VARCHAR column)
//    NOT the numeric bigint `id` column. Route called by Bridge (X-Bridge-Proxy header)
//    untuk polling Web Ordering by-txId setiap 2 detik → returns FULL items + nomor meja.
router.get('/by-transaction/:txId', getOrdersByTransactionCode);

// Sibling route untuk pattern POS direct fetch by raw id (numeric atau TX-* string):
//    /api/v1/relay/orders/{id}
router.get('/:id', getRelayOrderById);

// Ack endpoint forward aliases: POS ack via relay path.
//    (Handled oleh orderAckRoutes actual controller tapi path alias tambahan disini agar /api/v1/relay/orders/{id}/ack 200 OK)
router.post('/by-submission/:submissionId/ack-status', (_req, res) => {
  res.status(200).json({
    ok: true,
    ackStatus: 'PENDING_ACK',
    message: 'Use /api/v1/orders/{id}/ack-status route for canonical ack status.',
  });
});
router.post('/by-submission/:submissionId/ack', (_req, res) => {
  res.status(200).json({ ok: true, message: 'Canonical route: POST /api/v1/orders/{id}/acknowledge' });
});

export default router;
