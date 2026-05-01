import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { serializeForJson } from '../utils/serializeForJson';
import { closeShiftSchema, openShiftSchema } from '../validations/shiftValidation';
import { ShiftService } from '../services/shiftService';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }

  return tenantId;
}

function readUserId(req: Request): string {
  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError('User context is required', 401);
  }

  return userId;
}

function readBranchId(req: Request): bigint {
  const branchId = req.user?.branchId;
  if (!branchId) {
    throw new AppError('Branch context is required', 403);
  }

  if (!/^\d+$/.test(branchId)) {
    throw new AppError('Branch ID pada token tidak valid', 403);
  }

  return BigInt(branchId);
}

export const openShift = asyncHandler(async (req: Request, res: Response) => {
  const parsed = openShiftSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid open shift payload', 400);
  }

  const shift = await ShiftService.openShift({
    tenantId: readTenantId(req),
    branchId: readBranchId(req),
    userId: readUserId(req),
    startingCash: parsed.data.starting_cash,
  });

  return res.status(201).json({
    success: true,
    message: 'Shift opened successfully',
    data: serializeForJson(shift),
  });
});

export const getActiveShift = asyncHandler(async (req: Request, res: Response) => {
  const shift = await ShiftService.getActiveShift(
    readTenantId(req),
    readBranchId(req),
    readUserId(req),
  );

  return res.status(200).json({
    success: true,
    data: serializeForJson(shift),
  });
});

export const closeShift = asyncHandler(async (req: Request, res: Response) => {
  const parsed = closeShiftSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid close shift payload', 400);
  }

  const shift = await ShiftService.closeShift({
    tenantId: readTenantId(req),
    branchId: readBranchId(req),
    userId: readUserId(req),
    shiftId: BigInt(parsed.data.id),
    actualCash: parsed.data.actual_cash,
    actualQris: parsed.data.actual_qris,
    actualTransfer: parsed.data.actual_transfer,
  });

  return res.status(200).json({
    success: true,
    message: 'Shift closed successfully',
    data: serializeForJson(shift),
  });
});
