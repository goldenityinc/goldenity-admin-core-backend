import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { TransactionService } from '../services/transactionService';
import { resolveBranchFilter } from '../utils/branchIsolation';
import { serializeForJson } from '../utils/serializeForJson';

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
  const orderStatus = typeof req.query.orderStatus === 'string' ? req.query.orderStatus : undefined;
  const orderType = typeof req.query.orderType === 'string' ? req.query.orderType : undefined;
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
    pagination: result.pagination,
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
