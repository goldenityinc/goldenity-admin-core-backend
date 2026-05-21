import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { createSaleSchema } from '../validations/salesValidation';
import { SalesService } from '../services/salesService';
import { serializeForJson } from '../utils/serializeForJson';
import { resolveBranchFilter } from '../utils/branchIsolation';

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

export const createSale = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid sale payload', 400);
  }

  const result = await SalesService.createSale(readTenantId(req), parsed.data);

  return res.status(201).json({
    success: true,
    message: 'Sale created successfully',
    data: serializeForJson(result),
  });
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