import type { Request, Response } from 'express';
import AccountingReportService from '../services/accountingReportService';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

function readQueryString(query: Request['query'], key: string): string {
  const value = query[key];
  return typeof value === 'string' ? value.trim() : '';
}

function resolveTenantId(req: Request): string {
  const tenantId = readQueryString(req.query, 'tenantId') || req.user?.tenantId || '';
  if (!tenantId) {
    throw new AppError('tenantId tidak ditemukan pada request terautentikasi', 400);
  }
  return tenantId;
}

export const getProfitAndLossReport = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = resolveTenantId(req);
    const startDate = readQueryString(req.query, 'startDate');
    const endDate = readQueryString(req.query, 'endDate');

    if (!startDate || !endDate) {
      throw new AppError('startDate dan endDate wajib diisi', 400);
    }

    const report = await AccountingReportService.getProfitAndLossReport(
      tenantId,
      startDate,
      endDate,
    );

    return res.status(200).json({
      success: true,
      data: report,
    });
  },
);

export const getBalanceSheetReport = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = resolveTenantId(req);
    const asOfDate = readQueryString(req.query, 'asOfDate');

    if (!asOfDate) {
      throw new AppError('asOfDate wajib diisi', 400);
    }

    const report = await AccountingReportService.getBalanceSheetReport(
      tenantId,
      asOfDate,
    );

    return res.status(200).json({
      success: true,
      data: report,
    });
  },
);

export default {
  getProfitAndLossReport,
  getBalanceSheetReport,
};