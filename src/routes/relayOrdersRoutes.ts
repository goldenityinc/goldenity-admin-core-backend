import { Router } from 'express';
import {
  getOrdersByTransactionCode,
  getRelayOrderById,
  getActiveOrdersForTable,
  relayFlexibleAuth,
  patchRelayOrderSyncStatus,
} from '../controllers/relayOrdersController';

const router = Router({ mergeParams: true });

router.use(relayFlexibleAuth);

// ✅ ENDPOINT 0 (P0 FIX BRIDGE -> ADMIN CORE sync-status GAP G1):
//    PATCH /api/v1/relay/orders/sync-status
//    Bridge panggil ini SETELAH upstreamSavedQueuedAt tercatat & finalizeResolve/POS ack final.
//    Body: { submissionId, syncStatus: QUEUED_FOR_POS | POS_ACKNOWLEDGED | POS_PRINTED | SYNC_DELAYED | FAILED_DELIVERY,
//            salesRecordId?, transactionId?, tenantId, branchId? }
//    Efek Samping JIKA syncStatus in (QUEUED_FOR_POS, POS_ACKNOWLEDGED, POS_PRINTED) dan meja masih AVAILABLE
//      -> otomatis UPDATE tables SET status='OCCUPIED' + EMIT socket tables_refresh / table_status_changed
//         supaya POS grid meja refresh otomatis (redundant safety fallback dari createQrOrder tx).
router.patch('/sync-status', patchRelayOrderSyncStatus);
router.post('/sync-status', patchRelayOrderSyncStatus);
router.patch('/:id/sync-status', patchRelayOrderSyncStatus);
router.post('/:id/sync-status', patchRelayOrderSyncStatus);

// ✅ ENDPOINT 1 (Critical Fix 1 Items Kosong + Fix 2 Table Isolation):
//    GET /api/v1/relay/orders/by-transaction/TX-1786123768977?tenantId=X&branchId=Y&tableId=33
//    PRIORITAS items_json inline column, items selalu ADA.
//    Jika ?tableId=33 diset → WHERE table_id filter TIDAK BOcOR meja lain!
router.get('/by-transaction/:txId', getOrdersByTransactionCode);

// ✅ ENDPOINT 2 (Sibling route POS fetch by id):
//    /api/v1/relay/orders/{id} — accept numeric id ATAU TX-* string.
router.get('/:id', getRelayOrderById);

// ✅ ENDPOINT 3 (NEW — Fix 2 Cross-Table Contamination ISOLATION Web Ordering Order List):
//    GET /api/v1/relay/orders/active?tenantId=X&branchId=Y&tableId=33
//    WAJIB tableId → HANYA return order ACTIVE (PENDING/PREPARING) MILIK MEJA INI SAJA.
router.get('/active', getActiveOrdersForTable);

// Ack endpoint forward aliases (POS ack via relay path):
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
