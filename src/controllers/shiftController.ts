import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { serializeForJson } from '../utils/serializeForJson';
import { closeShiftSchema, openShiftSchema } from '../validations/shiftValidation';
import { ShiftService } from '../services/shiftService';
import prisma from '../config/database';

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

function parseOptionalBigInt(raw: unknown, fieldName: string): bigint | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const value = raw.toString().trim();
  if (!value) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new AppError(`${fieldName} harus berupa angka bulat positif`, 400);
  }

  return BigInt(value);
}

function parseOptionalDate(raw: unknown, fieldName: string, endOfDay = false): Date | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const value = raw.toString().trim();
  if (!value) {
    return undefined;
  }

  const hasExplicitTime = /t|\s\d{2}:\d{2}/i.test(value);
  const normalized = hasExplicitTime
    ? value
    : `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(`${fieldName} tidak valid`, 400);
  }
  return parsed;
}

function formatCurrencyIdr(raw: unknown): string {
  const value = Number(raw ?? 0);
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  return `Rp ${new Intl.NumberFormat('id-ID').format(safe)}`;
}

async function createAuditLogSafely(input: {
  tenantId: string;
  userId?: string | null;
  userName?: string | null;
  actionType: string;
  details: string;
}): Promise<void> {
  const tenantId = (input.tenantId ?? '').toString().trim();
  if (!tenantId) {
    return;
  }

  try {
    await prisma.audit_logs.create({
      data: {
        tenant_id: tenantId,
        user_id: (input.userId ?? '').toString().trim() || null,
        user_name: (input.userName ?? '').toString().trim() || null,
        action_type: input.actionType,
        details: input.details,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2021') {
      return;
    }
    throw error;
  }
}

export const getShifts = asyncHandler(async (req: Request, res: Response) => {
  const branchId = parseOptionalBigInt(req.query.branch_id, 'branch_id');
  const userId = (req.query.user_id ?? '').toString().trim() || undefined;
  const startDate = parseOptionalDate(req.query.start_date, 'start_date');
  const endDate = parseOptionalDate(req.query.end_date, 'end_date', true);

  const shifts = await ShiftService.listShifts({
    tenantId: readTenantId(req),
    branchId,
    userId,
    startDate,
    endDate,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(shifts),
  });
});
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

  await createAuditLogSafely({
    tenantId: (req.user?.tenantId ?? '').toString(),
    userId: (req.user?.userId ?? '').toString(),
    userName: (req.user?.email ?? '').toString(),
    actionType: 'OPEN_SHIFT',
    details: `Membuka shift kasir dengan saldo awal ${formatCurrencyIdr(parsed.data.starting_cash)}`,
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

  await createAuditLogSafely({
    tenantId: (req.user?.tenantId ?? '').toString(),
    userId: (req.user?.userId ?? '').toString(),
    userName: (req.user?.email ?? '').toString(),
    actionType: 'CLOSE_SHIFT',
    details: `Menutup shift kasir dengan selisih ${formatCurrencyIdr((shift as any).difference_cash ?? 0)}`,
  });

  return res.status(200).json({
    success: true,
    message: 'Shift closed successfully',
    data: serializeForJson(shift),
  });
});
