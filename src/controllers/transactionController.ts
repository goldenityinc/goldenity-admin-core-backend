import type { OrderStatus, OrderType } from '@prisma/client';
import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { TransactionService } from '../services/transactionService';
import { resolveBranchFilter } from '../utils/branchIsolation';
import { serializeForJson } from '../utils/serializeForJson';

const ORDER_STATUS_VALUES = new Set<OrderStatus>([
  'PENDING',
  'PREPARING',
  'READY_FOR_PICKUP',
  'COMPLETED',
  'CANCELLED',
]);

const ORDER_TYPE_VALUES = new Set<OrderType>([
  'WALK_IN',
  'PRE_ORDER',
  'DELIVERY',
]);

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  return tenantId;
}

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`Tanggal tidak valid: ${value}`, 400);
  }
  return d;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseOptionalEnum<T extends string>(
  value: unknown,
  label: string,
  allowedValues: Set<T>,
): T | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const normalizedValue = value.trim().toUpperCase() as T;
  if (!allowedValues.has(normalizedValue)) {
    throw new AppError(`${label} tidak valid: ${value}`, 400);
  }

  return normalizedValue;
}

/**
 * GET /api/v1/transactions
 *
 * Branch isolation logic:
 * - isHQ === true + no `branchId` query param  → sees all branches for tenant
 * - isHQ === true + `branchId` query param      → sees only that branch
 * - Non-HQ (Kasir, CRM_STAFF, etc.)            → MUST see only their JWT branchId
 */
export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = resolveBranchFilter(req);

  const startDate = parseOptionalDate(req.query.startDate);
  const endDate = parseOptionalDate(req.query.endDate);
  const orderStatus = parseOptionalEnum(req.query.orderStatus, 'orderStatus', ORDER_STATUS_VALUES);
  const orderType = parseOptionalEnum(req.query.orderType, 'orderType', ORDER_TYPE_VALUES);
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 50);

  const result = await TransactionService.listTransactions({
    tenantId,
    branchId,
    startDate,
    endDate,
    orderStatus,
    orderType,
    page,
    limit,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(result.records),
    pagination: serializeForJson(result.pagination),
  });
});

/**
 * GET /api/v1/transactions/:id
 *
 * Returns 404 (not 403) when the record exists but belongs to a different branch,
 * to avoid leaking information about record existence.
 */
export const getTransaction = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = resolveBranchFilter(req);

  const rawId = req.params.id;
  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID transaksi tidak valid', 400);
  }

  const record = await TransactionService.getTransactionById(tenantId, BigInt(rawId), branchId);

  if (!record) {
    throw new AppError('Transaksi tidak ditemukan', 404);
  }

  return res.status(200).json({
    success: true,
    data: serializeForJson(record),
  });
});
