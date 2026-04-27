import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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

function rethrowAccountingReportError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2021' || error.code === 'P2022') {
      throw new AppError(
        'Modul akuntansi backend belum selesai disiapkan. Tabel jurnal atau chart of accounts belum tersedia.',
        503,
      );
    }
  }

  if (error instanceof Error) {
    if (
      error.message.includes('Tanggal tidak valid') ||
      error.message.includes('startDate tidak boleh lebih besar dari endDate')
    ) {
      throw new AppError(error.message, 400);
    }
  }

  throw error;
}

export const getProfitAndLossReport = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = resolveTenantId(req);
    const startDate = readQueryString(req.query, 'startDate');
    const endDate = readQueryString(req.query, 'endDate');

    if (!startDate || !endDate) {
      throw new AppError('startDate dan endDate wajib diisi', 400);
    }

    try {
      const report = await AccountingReportService.getProfitAndLossReport(
        tenantId,
        startDate,
        endDate,
      );

      return res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      rethrowAccountingReportError(error);
    }
  },
);

export const getBalanceSheetReport = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = resolveTenantId(req);
    const asOfDate = readQueryString(req.query, 'asOfDate');

    if (!asOfDate) {
      throw new AppError('asOfDate wajib diisi', 400);
    }

    try {
      const report = await AccountingReportService.getBalanceSheetReport(
        tenantId,
        asOfDate,
      );

      return res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      rethrowAccountingReportError(error);
    }
  },
);

export default {
  getProfitAndLossReport,
  getBalanceSheetReport,
};