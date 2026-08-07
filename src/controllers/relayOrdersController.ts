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

function normalizeItems(record: {
  id: bigint; items_json: unknown; tenant_id: string | null;
}, dbItems: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const recordItems = dbItems
    .filter((it) => String((it as { sales_record_id?: bigint }).sales_record_id ?? '') === String(record.id))
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
      return {
        id: String(item.id ?? `${record.id}-${item.product_id ?? 'item'}`),
        productId: String(item.product_id ?? ''),
        product_id: String(item.product_id ?? ''),
        name,
        productName: name,
        product_name: name,
        qty,
        quantity: qty,
        price,
        unitPrice: price,
        unit_price: price,
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
  if (recordItems.length > 0) return recordItems;
  // Fallback items_json
  try {
    const json = record.items_json;
    if (Array.isArray(json) && json.length > 0) {
      return json.map((raw, i) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        const name = String(
          it.name ?? it.productName ?? it.product_name ?? it.custom_name ?? '',
        ).trim() || `Item ${i + 1}`;
        const qty = toFinite(it.qty ?? it.quantity) ?? 0;
        const price = toFinite(it.price ?? it.unitPrice ?? it.unit_price ?? it.customPrice ?? it.sale_price) ?? 0;
        const notes = String(it.notes ?? it.note ?? '').trim();
        return {
          id: String(it.id ?? `${record.id}-fallback-${i}`),
          productId: String(it.productId ?? it.product_id ?? ''),
          product_id: String(it.productId ?? it.product_id ?? ''),
          name,
          productName: name,
          product_name: name,
          qty,
          quantity: qty,
          price,
          unitPrice: price,
          unit_price: price,
          isService: Boolean(it.isService ?? it.is_service),
          is_service: Boolean(it.isService ?? it.is_service),
          notes,
          note: notes,
        };
      });
    }
  } catch { /* ignore */ }
  return [];
}

function buildRelayOrderPayload(
  record: Prisma.sales_recordsGetPayload<{ select: typeof relayOrderSelect }> & {
    items?: Array<Record<string, unknown>>;
    _txCode?: string;
  },
): Record<string, unknown> {
  const txCode = record._txCode ?? record.receipt_number ?? record.reference_id ?? String(record.id);
  const table = record.table as { id?: bigint; table_number?: unknown } | null | undefined;
  const tableNumberRaw = table?.table_number ?? null;
  const tableNumber = tableNumberRaw == null ? null : String(tableNumberRaw);
  const tableId = table?.id ?? record.table_id ?? null;
  const items = record.items ?? [];
  const totalAmount = toFinite(record.total_amount) ?? toFinite(record.total_price) ?? toFinite(record.amount_paid) ?? 0;
  const paymentMethod = String(record.payment_method ?? record.payment_type ?? '').trim() || null;
  const customerName = String(record.customer_name ?? record.cashier_name ?? '').trim() || null;
  const orderStatus = String(record.order_status || 'PENDING').trim().toUpperCase();
  return {
    submissionId: String(record.reference_id || record.receipt_number || record.id),
    orderId: String(record.id),
    salesRecordId: String(record.id),
    sales_record_id: String(record.id),
    transactionId: txCode,
    txId: txCode,
    ackStatus: mapStatusToAck(orderStatus),
    orderStatus,
    order_status: orderStatus,
    paymentStatus: record.payment_status,
    payment_status: record.payment_status,
    tableNumber,
    table_number: tableNumber,
    tableId: tableId ? String(tableId) : null,
    table_id: tableId ? String(tableId) : null,
    totalAmount,
    total_amount: totalAmount,
    totalPrice: toFinite(record.total_price),
    total_price: toFinite(record.total_price),
    amountPaid: toFinite(record.amount_paid),
    amount_paid: toFinite(record.amount_paid),
    paymentMethod,
    payment_method: paymentMethod,
    items,
    itemCount: items.length,
    customerName,
    customer_name: customerName,
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
    referenceId: record.reference_id,
    reference_id: record.reference_id,
  };
}

export const getOrdersByTransactionCode = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = resolveRelayTenantId(req);
  if (!tenantId) {
    return res.status(200).json([]);
  }
  const branchId = resolveRelayBranchId(req);
  const rawTx = (req.params.txId ?? req.params.id ?? '').toString().trim();
  if (!rawTx) {
    return res.status(200).json([]);
  }
  const isNumeric = /^\d+$/.test(rawTx);
  const strippedNumeric = /^(TX-|TX_|tx-|tx_)/i.test(rawTx)
    ? rawTx.replace(/^(TX-|TX_|tx-|tx_)/i, '').trim()
    : null;
  const strippedIsNumeric = strippedNumeric ? /^\d+$/.test(strippedNumeric) : false;

  const whereClauses: Array<Prisma.sales_recordsWhereInput> = [];
  whereClauses.push({ receipt_number: { equals: rawTx, mode: 'insensitive' } });
  whereClauses.push({ reference_id: { equals: rawTx, mode: 'insensitive' } });
  if (strippedNumeric) {
    whereClauses.push({ receipt_number: { equals: strippedNumeric, mode: 'insensitive' } });
    whereClauses.push({ reference_id: { equals: strippedNumeric, mode: 'insensitive' } });
  }
  if (isNumeric) {
    try { whereClauses.push({ id: BigInt(rawTx) }); } catch { /* ignore */ }
  }
  if (strippedIsNumeric) {
    try { whereClauses.push({ id: BigInt(strippedNumeric as string) }); } catch { /* ignore */ }
  }

  const where: Prisma.sales_recordsWhereInput = {
    tenant_id: tenantId,
    ...(branchId !== null ? { branch_id: branchId } : {}),
    OR: whereClauses,
  };

  const records = await prisma.sales_records.findMany({
    where,
    select: relayOrderSelect,
    orderBy: { created_at: 'desc' },
    take: 20,
  });

  if (records.length === 0) {
    return res.status(200).json([]);
  }

  const recordIds = records.map((r) => r.id);
  const dbItems = await prisma.sales_record_items.findMany({
    where: { tenant_id: tenantId, sales_record_id: { in: recordIds } },
    select: relayItemSelect,
    orderBy: [{ sales_record_id: 'asc' }, { id: 'asc' }],
  }).catch(() => []);

  const recordsWithTx = records.map((r) => {
    const items = normalizeItems({ id: r.id, items_json: r.items_json, tenant_id: r.tenant_id }, (dbItems as unknown) as Array<Record<string, unknown>>);
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
  const tenantId = resolveRelayTenantId(req);
  if (!tenantId) {
    return res.status(200).json([]);
  }
  const rawId = (req.params.id ?? '').toString().trim();
  if (!rawId) return res.status(200).json([]);
  req.params.txId = rawId;
  return getOrdersByTransactionCode(req, res, next);
});
