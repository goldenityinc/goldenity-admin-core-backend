import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { serializeForJson } from '../utils/serializeForJson';
import { internalServiceAuth } from '../middlewares/internalServiceAuth';
import { authMiddleware, tenantMiddleware } from '../middlewares/authMiddleware';

function resolveRelayTenantId(req: Request): string | null {
  const fromUser = (req as unknown as { user?: { tenantId?: string; tenant_id?: string } }).user?.tenantId
    ?? (req as unknown as { user?: { tenantId?: string; tenant_id?: string } }).user?.tenant_id;
  if (fromUser) return String(fromUser).trim() || null;
  const fromQuery = req.query.tenantId ?? req.query.tenant_id ?? req.headers['x-tenant-id'] ?? req.headers['tenant-id'];
  if (fromQuery) return String(fromQuery).trim() || null;
  return null;
}

function resolveRelayBranchId(req: Request): bigint | null {
  const raw = req.query.branchId ?? req.query.branch_id ?? req.headers['x-branch-id'];
  if (!raw || typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  try { return BigInt(raw); } catch { return null; }
}

function resolveRelayTableId(req: Request): bigint | null {
  const raw = req.query.tableId ?? req.query.table_id ?? req.headers['x-table-id'];
  if (!raw || typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  try { return BigInt(raw); } catch { return null; }
}

export function relayFlexibleAuth(req: Request, res: Response, next: NextFunction) {
  const hasInternalToken = Boolean((req.headers['x-internal-token'] || '').toString().trim());
  const hasBridgeHeader =
    (req.headers['x-bridge-proxy'] || '').toString().trim() === '1' ||
    (req.headers['x-internal-relay'] || '').toString().trim() === '1';
  if (hasInternalToken) {
    return internalServiceAuth(req, res, next);
  }
  if (hasBridgeHeader) {
    const tenantId = resolveRelayTenantId(req);
    if (tenantId) {
      (req as unknown as { user?: { tenantId: string; role: string } }).user = {
        tenantId,
        role: 'INTERNAL_BRIDGE',
      };
      return next();
    }
  }
  return authMiddleware(req, res, (err?: unknown) => {
    if (err) return next(err);
    const user = (req as unknown as { user?: { tenantId?: string } }).user;
    if (user?.tenantId) return tenantMiddleware(req, res, next);
    return next();
  });
}

const relayOrderSelect = Prisma.validator<Prisma.sales_recordsSelect>()({
  id: true,
  tenant_id: true,
  branch_id: true,
  table_id: true,
  reference_id: true,
  payment_method: true,
  payment_type: true,
  order_status: true,
  total_price: true,
  total_amount: true,
  amount_paid: true,
  created_at: true,
  updated_at: true,
  receipt_number: true,
  customer_name: true,
  cashier_name: true,
  payment_status: true,
  items_json: true,
  order_type: true,
  table: {
    select: { id: true, table_number: true, status: true },
  },
});

const relayItemSelect = Prisma.validator<Prisma.sales_record_itemsSelect>()({
  id: true,
  sales_record_id: true,
  product_id: true,
  product_name: true,
  qty: true,
  custom_price: true,
  note: true,
  item_note: true,
  notes: true,
  is_service: true,
  is_custom_item: true,
  custom_name: true,
  mechanic_id: true,
  employee_id: true,
  created_at: true,
});

function toFinite(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapStatusToAck(status: string | null): string {
  const s = String(status || '').trim().toUpperCase();
  if (!s) return 'PENDING_ACK';
  switch (s) {
    case 'COMPLETED':
    case 'PAID':
    case 'POS_PRINTED':
      return 'POS_PRINTED';
    case 'PREPARING':
    case 'READY_FOR_PICKUP':
      return 'POS_ACKNOWLEDGED';
    case 'PENDING':
    case 'PENDING_PAYMENT':
      return 'PENDING_ACK';
    case 'CANCELLED':
    case 'VOID':
      return 'FAILED_DELIVERY';
    default:
      return s;
  }
}

function timeoutAfterMs<T>(ms: number, fallback: T, _label = 'db'): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      clearTimeout(t);
      resolve(fallback);
    }, ms);
    try {
      (t as unknown as { unref?: () => void }).unref?.();
    } catch { /* ignore */ }
  }).catch(() => fallback) as Promise<T>;
}

/**
 * ✅ CRITICAL FIX 1 — ITEMS KOSONG (EMPTY ITEMS ARRAY):
 *    PRE-parse items DARI items_json (inlin JSON column sales_records) TERLEBIH DAHULU.
 *    items_json DISIMPAN BERSAMAAN commit transaction createQrOrder → SELALU ADA,
 *    BAHKAN SEBELUM rows sales_record_items relation di-insert secara async.
 *    Sebelumnya parse DB relation first → race condition empty items polling <10 detik.
 *
 *    items_json shape: Array<{productId, qty, note?, customPrice?, batch_sequence?}>
 *    Falls back ke sales_record_items rows relation jika items_json kosong.
 */
function parseItemsFromItemsJson(
  itemsJson: unknown,
  recordId: bigint,
): Array<Record<string, unknown>> {
  try {
    if (Array.isArray(itemsJson) && itemsJson.length > 0) {
      return itemsJson.map((raw, i) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        const hasProductName = Boolean(it.productName || it.product_name || it.custom_name);
        const rawName = String(
          it.name ?? it.productName ?? it.product_name ?? it.custom_name ?? '',
        ).trim();
        const name = rawName || (hasProductName ? '' : `Item ${i + 1}`);
        const qty = toFinite(it.qty ?? it.quantity) ?? 0;
        const price = toFinite(it.price ?? it.unitPrice ?? it.unit_price ?? it.customPrice ?? it.custom_price ?? it.sale_price ?? it.harga_jual) ?? 0;
        const notes = String(it.notes ?? it.note ?? it.item_note ?? '').trim();
        const productId = String(it.productId ?? it.product_id ?? it.id ?? '');
        return {
          id: String(it.id ?? it.batch_sequence ? `${recordId}-batch-${it.batch_sequence}-${i}` : `${recordId}-fallback-${i}`),
          productId,
          product_id: productId,
          name: name || `Produk ${i + 1}`,
          productName: name || `Produk ${i + 1}`,
          product_name: name || `Produk ${i + 1}`,
          qty,
          quantity: qty,
          price,
          unitPrice: price,
          unit_price: price,
          subtotal: qty > 0 && price > 0 ? qty * price : (toFinite(it.subtotal) ?? 0),
          customPrice: toFinite(it.customPrice ?? it.custom_price),
          custom_price: toFinite(it.customPrice ?? it.custom_price),
          batchSequence: toFinite(it.batch_sequence ?? it.batchSequence),
          batch_sequence: toFinite(it.batch_sequence ?? it.batchSequence),
          isService: Boolean(it.isService ?? it.is_service),
          is_service: Boolean(it.isService ?? it.is_service),
          isCustomItem: Boolean(it.isCustomItem ?? it.is_custom_item),
          is_custom_item: Boolean(it.isCustomItem ?? it.is_custom_item),
          notes,
          note: notes,
        };
      });
    }
  } catch { /* ignore */ }
  return [];
}

function parseItemsFromDbRelation(
  dbItems: Array<Record<string, unknown>>,
  recordId: bigint,
): Array<Record<string, unknown>> {
  return dbItems
    .filter((it) => String((it as { sales_record_id?: bigint }).sales_record_id ?? '') === String(recordId))
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      const price = toFinite(item.custom_price) ?? 0;
      const qty = toFinite(item.qty) ?? 0;
      const notes = String(
        (item.note ?? item.item_note ?? item.notes ?? '') as string,
      ).trim();
      const name = String(
        (item.custom_name ?? item.product_name ?? '') as string,
      ).trim() || 'Item';
      const productId = String(item.product_id ?? '');
      return {
        id: String(item.id ?? `${recordId}-${productId || 'item'}`),
        productId,
        product_id: productId,
        name,
        productName: name,
        product_name: name,
        qty,
        quantity: qty,
        price,
        unitPrice: price,
        unit_price: price,
        subtotal: qty > 0 && price > 0 ? qty * price : 0,
        customPrice: toFinite(item.custom_price),
        custom_price: toFinite(item.custom_price),
        isService: Boolean(item.is_service),
        is_service: Boolean(item.is_service),
        isCustomItem: Boolean(item.is_custom_item),
        is_custom_item: Boolean(item.is_custom_item),
        mechanicId: String(item.mechanic_id ?? ''),
        mechanic_id: String(item.mechanic_id ?? ''),
        employeeId: String(item.employee_id ?? ''),
        employee_id: String(item.employee_id ?? ''),
        notes,
        note: notes,
      };
    });
}

function normalizeItems(record: {
  id: bigint; items_json: unknown; tenant_id: string | null;
}, dbItems: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  // 🔴 PRIORITAS UTAMA: items_json inline column (disimpan BERSAMA create order transaction)
  const fromInlineJson = parseItemsFromItemsJson(record.items_json, record.id);
  if (fromInlineJson.length > 0) return fromInlineJson;
  // Fallback jika items_json empty/null: baca dari DB relation sales_record_items
  return parseItemsFromDbRelation(dbItems, record.id);
}

function resolveTableNumber(record: {
  table_id: bigint | null;
  table: unknown;
  items_json: unknown;
}): string | null {
  const table = record.table as { id?: bigint; table_number?: unknown } | null | undefined;
  const rawTableNumber = table?.table_number ?? record.table_id ?? null;
  const str = rawTableNumber == null ? '' : String(rawTableNumber).trim();
  if (str) return str;
  try {
    const json = record.items_json;
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const meta = (json as { tableNumber?: unknown; table_number?: unknown; table?: unknown });
      const fromMeta = String(meta.tableNumber ?? meta.table_number ?? meta.table ?? '').trim();
      if (fromMeta) return fromMeta;
    }
  } catch { /* ignore */ }
  return null;
}

function buildRelayOrderPayload(
  record: Prisma.sales_recordsGetPayload<{ select: typeof relayOrderSelect }> & {
    items?: Array<Record<string, unknown>>;
    _txCode?: string;
  },
): Record<string, unknown> {
  const txCode = record._txCode ?? record.receipt_number ?? record.reference_id ?? String(record.id);
  const tableNumber = resolveTableNumber(record);
  const table = record.table as { id?: bigint } | null | undefined;
  const tableId = table?.id ?? record.table_id ?? null;
  const items = record.items ?? [];
  const totalAmount = toFinite(record.total_amount) ?? toFinite(record.total_price) ?? toFinite(record.amount_paid) ?? 0;
  const paymentMethod = String(record.payment_method ?? record.payment_type ?? '').trim() || null;
  const customerName = String(record.customer_name ?? record.cashier_name ?? '').trim() || null;
  const orderStatus = String(record.order_status || 'PENDING').trim().toUpperCase();

  // 🔴 CRITICAL FIX: Pax fallback extract dari items_json metadata
  //    (banyak prisma sales_records TIDAK PUNYA column pax, ambil dari item[*].metadata.pax)
  const anyRecord = record as Record<string, unknown>;
  let paxFinal: number | null = toFinite(anyRecord.pax) ?? null;
  if ((paxFinal == null || paxFinal <= 0) && Array.isArray(items) && items.length > 0) {
    try {
      for (const it of items) {
        const m = it.metadata || it.meta;
        if (m && typeof m === 'object') {
          const p = toFinite((m as Record<string, unknown>).pax) ?? 0;
          if (p > 0) { paxFinal = p; break; }
        }
      }
    } catch { /* ignore */ }
  }
  const paxOut = (paxFinal != null && paxFinal > 0) ? paxFinal : null;

  // 🔴 CRITICAL FIX: Special notes aliases
  //    Prisma type select TIDAK expose special_note column, tapi di DB ada.
  //    Pakai anyRecord + order_id fallback chain.
  const specialNoteDirect = (
    anyRecord.special_note ?? anyRecord.specialNote ?? anyRecord.notes ?? anyRecord.note ??
    anyRecord.orderNote ?? anyRecord.order_notes ?? ''
  ).toString().trim();
  const notesOut = specialNoteDirect.length > 0 ? specialNoteDirect : null;

  const customerOut = customerName && customerName.length > 0 ? customerName : null;
  const tableOut = tableNumber && tableNumber.length > 0 ? tableNumber : (tableId ? String(tableId) : null);

  return {
    submissionId: String(record.reference_id || record.receipt_number || record.id),
    orderId: String(record.id),
    order_id: String(record.id),
    salesRecordId: String(record.id),
    sales_record_id: String(record.id),
    transactionId: txCode,
    transaction_id: txCode,
    txId: txCode,
    ackStatus: mapStatusToAck(orderStatus),
    orderStatus,
    order_status: orderStatus,
    paymentStatus: record.payment_status,
    payment_status: record.payment_status,
    tableNumber: tableOut,
    table_number: tableOut,
    tableName: tableOut,
    table_name: tableOut,
    tableLabel: tableOut,
    table_label: tableOut,
    tableId: tableId ? String(tableId) : null,
    table_id: tableId ? String(tableId) : null,
    totalAmount,
    total_amount: totalAmount,
    grandTotal: totalAmount,
    grand_total: totalAmount,
    subtotal: totalAmount,
    totalPrice: toFinite(record.total_price),
    total_price: toFinite(record.total_price),
    amountPaid: toFinite(record.amount_paid),
    amount_paid: toFinite(record.amount_paid),
    paymentMethod,
    payment_method: paymentMethod,
    items,
    itemCount: items.length,
    pax: paxOut,
    guestCount: paxOut,
    guests: paxOut,
    customer_count: paxOut,
    orderNote: notesOut,
    order_note: notesOut,
    order_notes: notesOut,
    notes: notesOut,
    note: notesOut,
    specialNote: notesOut,
    special_note: notesOut,
    specialInstruction: notesOut,
    special_instruction: notesOut,
    remarks: notesOut,
    remark: notesOut,
    catatan: notesOut,
    catatan_pesanan: notesOut,
    customerName: customerOut,
    customer_name: customerOut,
    customer: customerOut,
    guest: customerOut,
    guestName: customerOut,
    pelanggan: customerOut,
    pembeli: customerOut,
    orderType: record.order_type,
    order_type: record.order_type,
    resolvedDeviceUuid: null,
    createdAt: record.created_at?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: record.updated_at?.toISOString?.() ?? null,
    resolvedAt: record.updated_at?.toISOString?.() ?? null,
    posPrintedAt: (orderStatus === 'COMPLETED' || orderStatus === 'POS_PRINTED') ? (record.updated_at?.toISOString?.() ?? null) : null,
    failedDeliveryAt: orderStatus === 'CANCELLED' || orderStatus === 'VOID' ? (record.updated_at?.toISOString?.() ?? null) : null,
    tenantId: record.tenant_id,
    branchId: record.branch_id ? String(record.branch_id) : null,
    branch_id: record.branch_id ? String(record.branch_id) : null,
    receiptNumber: record.receipt_number,
    receipt_number: record.receipt_number,
    invoiceNumber: record.receipt_number,
    invoice_number: record.receipt_number,
    referenceId: record.reference_id,
    reference_id: record.reference_id,
  };
}

function buildTransactionFallbackWhereClauses(rawTx: string): Array<Prisma.sales_recordsWhereInput> {
  const clauses: Array<Prisma.sales_recordsWhereInput> = [];
  const isNumeric = /^\d+$/.test(rawTx);
  const stripped = /^(TX-|TX_|tx-|tx_)/i.test(rawTx)
    ? rawTx.replace(/^(TX-|TX_|tx-|tx_)/i, '').trim()
    : null;
  const strippedIsNumeric = stripped ? /^\d+$/.test(stripped) : false;
  clauses.push({ receipt_number: { equals: rawTx, mode: 'insensitive' } });
  clauses.push({ reference_id: { equals: rawTx, mode: 'insensitive' } });
  if (stripped) {
    clauses.push({ receipt_number: { equals: stripped, mode: 'insensitive' } });
    clauses.push({ reference_id: { equals: stripped, mode: 'insensitive' } });
  }
  if (isNumeric) {
    try { clauses.push({ id: BigInt(rawTx) }); } catch { /* ignore */ }
  }
  if (strippedIsNumeric) {
    try { clauses.push({ id: BigInt(stripped as string) }); } catch { /* ignore */ }
  }
  return clauses;
}

function buildScopeFilters(req: Request): {
  tenantId: string | null;
  branchId: bigint | null;
  tableId: bigint | null;
} {
  return {
    tenantId: resolveRelayTenantId(req),
    branchId: resolveRelayBranchId(req),
    tableId: resolveRelayTableId(req),
  };
}

export const getOrdersByTransactionCode = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, branchId, tableId } = buildScopeFilters(req);
  if (!tenantId) {
    return res.status(200).json([]);
  }
  const rawTx = (req.params.txId ?? req.params.id ?? '').toString().trim();
  if (!rawTx) {
    return res.status(200).json([]);
  }

  const where: Prisma.sales_recordsWhereInput = {
    tenant_id: tenantId,
    ...(branchId !== null ? { branch_id: branchId } : {}),
    // ✅ FIX 2 — CROSS-TABLE CONTAMINATION ISOLATION:
    //    JIKA client mengirim ?tableId=33 → WHERE table_id = 33
    //    Agar meja 3 hanya melihat order milik dirinya, tidak bocor meja lain.
    ...(tableId !== null ? { table_id: tableId } : {}),
    OR: buildTransactionFallbackWhereClauses(rawTx),
  };

  // ✅ FIX 3 — SLOW / TIMEOUT RACE:
  //    Promise.race PRISMA query vs timeout 1.2s fallback empty array [].
  //    Tidak hang frontend, response selalu <1.5 detik.
  const recordsRace = Promise.race<Array<Prisma.sales_recordsGetPayload<{ select: typeof relayOrderSelect }>>>([
    prisma.sales_records.findMany({
      where,
      select: relayOrderSelect,
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    timeoutAfterMs(1200, [], 'sales_records findMany'),
  ]);

  const records: Array<Prisma.sales_recordsGetPayload<{ select: typeof relayOrderSelect }>> = (await recordsRace.catch(() => [])) || [];
  if (records.length === 0) {
    return res.status(200).json([]);
  }

  // ✅ OPTIMIZE FAST PATH: items_json exists untuk record apapun → LEWATI db items query SAMA SEKALI
  //    Menghemat 1 query SELECT sales_record_items + join latensi (100ms -> 0ms).
  let dbItems: Array<Record<string, unknown>> = [];
  const needDbItems = records.some((r) => {
    try { return !(r.items_json && Array.isArray(r.items_json) && (r.items_json as Array<unknown>).length > 0); } catch { return true; }
  });
  if (needDbItems) {
    const recordIds = records.map((r) => r.id);
    dbItems = (await Promise.race<Array<unknown>>([
      prisma.sales_record_items.findMany({
        where: { tenant_id: tenantId, sales_record_id: { in: recordIds } },
        select: relayItemSelect,
        orderBy: [{ sales_record_id: 'asc' }, { id: 'asc' }],
      }),
      timeoutAfterMs(800, [], 'sales_record_items findMany'),
    ]).catch(() => [])) as Array<Record<string, unknown>>;
  }

  const recordsWithTx = records.map((r) => {
    const items = normalizeItems({ id: r.id, items_json: r.items_json, tenant_id: r.tenant_id }, dbItems);
    let txCode = rawTx;
    if (String(r.receipt_number || '').toLowerCase() === rawTx.toLowerCase()) txCode = r.receipt_number as string;
    else if (String(r.reference_id || '').toLowerCase() === rawTx.toLowerCase()) txCode = r.reference_id as string;
    else txCode = (r.receipt_number ?? r.reference_id ?? rawTx ?? String(r.id)) as string;
    return { ...r, items, _txCode: txCode };
  });

  const payload = recordsWithTx.map(buildRelayOrderPayload);
  return res.status(200).json(serializeForJson(payload));
});

export const getRelayOrderById = asyncHandler(async (req: Request, res: Response, next: import('express').NextFunction) => {
  const { tenantId } = buildScopeFilters(req);
  if (!tenantId) {
    return res.status(200).json([]);
  }
  const rawId = (req.params.id ?? '').toString().trim();
  if (!rawId) return res.status(200).json([]);
  req.params.txId = rawId;
  return getOrdersByTransactionCode(req, res, next);
});

/**
 * ✅ NEW ENDPOINT: Active Orders untuk Web Ordering UI Order List per MEJA
 *    Route: GET /api/v1/relay/orders/active
 *    PARAMS WAJIB via query: tenantId, branchId, tableId
 *    WHERE clause ISOLATION per table_id: hanya order milik meja TERSEBUT yang ditampilkan.
 *    Filter order_status: HANYA ACTIVE (PENDING/PREPARING/READY_FOR_PICKUP/PENDING_PAYMENT) —
 *    exclude COMPLETED / POS_PRINTED / CANCELLED / VOID supaya history lama tidak tampil.
 */
export const getActiveOrdersForTable = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, branchId, tableId } = buildScopeFilters(req);
  if (!tenantId) {
    return res.status(200).json([]);
  }
  // ✅ FIX 2 CROSS-TABLE ISOLATION ENFORCEMENT: ENDPOINT INI WAJIB ADA tableId!
  //    Jika tidak ada tableId → return [] INSTANT (tidak bocor semua order branch).
  if (tableId === null) {
    return res.status(200).json([]);
  }

  const activeStatuses: Array<string> = ['PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'PENDING_PAYMENT', 'PARTIAL', 'NEW', 'OPEN', 'ACTIVE'];
  const excludedPaymentStatuses: Array<string> = ['PAID', 'REFUNDED', 'CANCELLED', 'VOID'];
  const where: Prisma.sales_recordsWhereInput = {
    tenant_id: tenantId,
    ...(branchId !== null ? { branch_id: branchId } : {}),
    table_id: tableId,
    order_status: { in: activeStatuses as unknown as never },
    AND: [
      { NOT: { order_status: { in: ['COMPLETED', 'CANCELLED', 'VOID', 'POS_PRINTED', 'REFUNDED'] as unknown as never } } },
      // 🔴 CRITICAL FIX 2: EXCLUDE SEMUA PAYMENT_STATUS = PAID / REFUNDED / VOID
      //    Query sebelumnya TIDAK filter payment_status. Akibatnya order QRIS yang SUDAH PAID
      //    tapi order_status masih PREPARING → masih muncul sebagai "active" di POS,
      //    dan POS salah menganggap order CASHIER yang lain sebagai PAID juga (contamination visual).
      //    Sekarang: HANYA tampilkan yang payment_status BELUM PAID / masih unpaid.
      {
        NOT: {
          payment_status: {
            in: excludedPaymentStatuses as unknown as never,
            mode: 'insensitive',
          },
        },
      },
    ],
  };

  // 🔴 CRITICAL FIX 2b:
  //    - orderBy CREATED_AT ASC → order TERLAMA muncul DULU, tidak terpotong take:50
  //      (sebelumnya DESC = latest first, jadi order lama Americano hilang, munculnya Kue Lapis saja)
  //    - take dinaikkan 50 → 200 agar edge case padat (1 table > 50 order) tetap ke load
  const records: Array<Prisma.sales_recordsGetPayload<{ select: typeof relayOrderSelect }>> = (
    await Promise.race([
      prisma.sales_records.findMany({
        where,
        select: relayOrderSelect,
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: 200,
      }),
      timeoutAfterMs(1500, [], 'activeOrders sales_records findMany'),
    ]).catch(() => [])
  ) as Array<Prisma.sales_recordsGetPayload<{ select: typeof relayOrderSelect }>>;

  if (records.length === 0) {
    return res.status(200).json([]);
  }

  let dbItems: Array<Record<string, unknown>> = [];
  const needDbItems = records.some((r) => {
    try { return !(r.items_json && Array.isArray(r.items_json) && (r.items_json as Array<unknown>).length > 0); } catch { return true; }
  });
  if (needDbItems) {
    const recordIds = records.map((r) => r.id);
    dbItems = (await Promise.race([
      prisma.sales_record_items.findMany({
        where: { tenant_id: tenantId, sales_record_id: { in: recordIds } },
        select: relayItemSelect,
      }),
      timeoutAfterMs(700, [], 'activeOrders items findMany'),
    ]).catch(() => [])) as Array<Record<string, unknown>>;
  }

  const withItems = records.map((r) => {
    const items = normalizeItems({ id: r.id, items_json: r.items_json, tenant_id: r.tenant_id }, dbItems);
    return {
      ...r,
      items,
      _txCode: (r.receipt_number ?? r.reference_id ?? String(r.id)) as string,
    };
  });

  const payload = withItems.map(buildRelayOrderPayload);
  return res.status(200).json(serializeForJson(payload));
});
