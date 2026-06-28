import type { Request, Response } from 'express';
import AccountingPostingService from '../services/accountingPostingService';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

function resolveTenantId(req: Request): string {
  const tenantId = req.user?.tenantId?.trim() || '';
  if (!tenantId) {
    throw new AppError('tenantId tidak ditemukan pada request terautentikasi', 400);
  }
  return tenantId;
}

export const resetLedgerDebug = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = resolveTenantId(req);
  const result = await AccountingPostingService.resetLedgerForTenant(tenantId);

  return res.status(200).json({
    success: true,
    message: 'Ledger tenant berhasil di-reset dan dibangun ulang.',
    data: result,
  });
});

export default {
  resetLedgerDebug,
};
