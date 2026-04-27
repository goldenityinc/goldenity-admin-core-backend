import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { createSaleSchema } from '../validations/salesValidation';
import { SalesService } from '../services/salesService';
import { serializeForJson } from '../utils/serializeForJson';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }

  return tenantId;
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