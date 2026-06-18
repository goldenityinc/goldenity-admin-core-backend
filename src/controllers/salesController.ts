import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { createSaleSchema } from '../validations/salesValidation';
import { SalesService } from '../services/salesService';
import { AuditLogService } from '../services/auditLogService';
import { serializeForJson } from '../utils/serializeForJson';
import { resolveBranchFilter } from '../utils/branchIsolation';
import { emitToTenant } from '../services/socketServer';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }

  return tenantId;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeRole(rawRole: unknown): string {
  return (rawRole ?? '').toString().trim().toUpperCase();
}

function parseNumericValue(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  const normalized = (raw ?? '')
    .toString()
    .trim()
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyIdr(raw: unknown): string {
  const value = parseNumericValue(raw);
  const rounded = Math.max(0, Math.round(value));
  return `Rp ${new Intl.NumberFormat('id-ID').format(rounded)}`;
}

function buildSaleItemsAuditText(items: Array<Record<string, unknown>>): string {
  if (items.length === 0) {
    return '-';
  }

  return items
    .map((item) => {
      const name = (item['product_name'] ??
        item['custom_name'] ??
        item['productName'] ??
        item['customName'] ??
        'Item')
        .toString()
        .trim();
      const qty = parseNumericValue(item['qty']);
      const safeQty = qty <= 0 ? 1 : qty;
      return `${name} (x${safeQty.toFixed(0)})`;
    })
    .join(', ');
}

export const createSale = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    console.error('[createSale] Validation failed:', parsed.error.issues);
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid sale payload', 400);
  }

  const normalizedPayload = {
    ...parsed.data,
    tableId: parsed.data.tableId ?? parsed.data.table_id,
    orderType: parsed.data.orderType ?? parsed.data.order_type,
    orderStatus: parsed.data.orderStatus ?? parsed.data.order_status,
  };

  try {
    const result = await SalesService.createSale(readTenantId(req), normalizedPayload);
    const serializedSale = serializeForJson(result.sale) as Record<string, unknown>;
    const rawSerializedItems = serializeForJson(result.items);
    const serializedItems = Array.isArray(rawSerializedItems)
      ? rawSerializedItems
          .filter(
            (item): item is Record<string, unknown> =>
              item !== null &&
              typeof item === 'object' &&
              !Array.isArray(item),
          )
          .map((item) => ({ ...item }))
      : [];

    const receiptNumber = (serializedSale.receipt_number ?? serializedSale.receiptNumber ?? '-')
      .toString()
      .trim();
    const totalAmount = serializedSale.total_amount ?? serializedSale.total_price ?? 0;
    const itemSummary = buildSaleItemsAuditText(serializedItems);
    const serializedStockUpdates = Array.isArray(result.stockUpdates)
      ? result.stockUpdates.map((entry) => ({
          productId: (entry.productId ?? '').toString().trim(),
          qty: Number(entry.qty ?? 0),
        }))
      : [];

    await AuditLogService.createLog({
      tenantId: readTenantId(req),
      userId: req.user?.userId,
      userName: req.user?.email,
      actionType: 'CREATE_SALE',
      details: `Membuat transaksi [${receiptNumber}] senilai ${formatCurrencyIdr(totalAmount)}. Item: ${itemSummary}`,
    });

    const tenantId = readTenantId(req);
    const socketPayload = {
      tenantId,
      type: 'TRANSACTION_CREATED',
      entity: 'transactions',
      table: 'sales_records',
      action: 'INSERT',
      recordId: serializedSale.id?.toString(),
      transaction: serializedSale,
      payload: { transaction: serializedSale },
      deviceId: req.header('X-Device-ID'),
      timestamp: new Date().toISOString(),
    };

    emitToTenant(tenantId, 'db_mutation', socketPayload);
    emitToTenant(tenantId, 'transaction_created', socketPayload);
    emitToTenant(tenantId, 'inventory_updated', {
      tenantId,
      entity: 'products',
      table: 'products',
      action: 'BULK_UPDATE',
      updates: serializedStockUpdates,
      transactionId: serializedSale.id?.toString(),
      deviceId: req.header('X-Device-ID'),
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[createSale] Sale created successfully. ID=${result.sale.id}, Items=${result.items.length}, Tenant=${readTenantId(req)}`
    );

    return res.status(201).json({
      success: true,
      message: 'Sale created successfully',
      data: {
        sale: serializedSale,
        items: serializedItems,
        stockUpdates: serializedStockUpdates,
      },
    });
  } catch (error) {
    console.error('[createSale] Error creating sale:', error);
    throw error;
  }
});

export const listPreOrders = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = resolveBranchFilter(req);
  const role = normalizeRole(req.user?.role);
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 50);

  const result = await SalesService.listPreOrders({
    tenantId,
    branchId,
    requireScopedBranch: role === 'CASHIER' || role === 'CRM_STAFF',
    requireAssignedBranch: role === 'TENANT_ADMIN' && branchId === null,
    page,
    limit,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(result.records),
    pagination: serializeForJson(result.pagination),
  });
});

export const getPreOrdersSummary = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = resolveBranchFilter(req);
  const role = normalizeRole(req.user?.role);

  const summary = await SalesService.getPreOrderSummary({
    tenantId,
    branchId,
    requireScopedBranch: role === 'CASHIER' || role === 'CRM_STAFF',
    requireAssignedBranch: role === 'TENANT_ADMIN' && branchId === null,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(summary),
  });
});