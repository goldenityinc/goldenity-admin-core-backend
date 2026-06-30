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

function resolveOptionalBranchId(query: Request['query']): bigint | null {
  const branchIdRaw = readQueryString(query, 'branchId');

  if (!branchIdRaw) {
    return null;
  }

  if (branchIdRaw.toLowerCase() === 'semua') {
    return null;
  }

  if (!/^\d+$/.test(branchIdRaw)) {
    throw new AppError('branchId harus berupa angka atau "Semua"', 400);
  }

  return BigInt(branchIdRaw);
}

function sanitizeAccountingJsonValue(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAccountingJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeAccountingJsonValue(entry),
      ]),
    );
  }

  return value;
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
      error.message.includes('startDate tidak boleh lebih besar dari endDate') ||
      error.message.includes('month harus 1-12') ||
      error.message.includes('year harus valid')
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
    const branchId = resolveOptionalBranchId(req.query);

    if (!startDate || !endDate) {
      throw new AppError('startDate dan endDate wajib diisi', 400);
    }

    try {
      const report = await AccountingReportService.getProfitAndLossReport(
        tenantId,
        startDate,
        endDate,
        branchId,
      );

      return res.status(200).json({
        success: true,
        data: sanitizeAccountingJsonValue(report),
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
    const branchId = resolveOptionalBranchId(req.query);

    if (!asOfDate) {
      throw new AppError('asOfDate wajib diisi', 400);
    }

    try {
      const report = await AccountingReportService.getBalanceSheetReport(
        tenantId,
        asOfDate,
        branchId,
      );

      return res.status(200).json({
        success: true,
        data: sanitizeAccountingJsonValue(report),
      });
    } catch (error) {
      rethrowAccountingReportError(error);
    }
  },
);

export const getPayrollReport = asyncHandler(
  async (req: Request, res: Response) => {
    const tenantId = resolveTenantId(req);
    const branchId = resolveOptionalBranchId(req.query);
    const monthRaw = readQueryString(req.query, 'month');
    const yearRaw = readQueryString(req.query, 'year');

    if (!monthRaw || !yearRaw) {
      throw new AppError('month dan year wajib diisi', 400);
    }

    const month = Number(monthRaw);
    const year = Number(yearRaw);

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new AppError('month harus 1-12', 400);
    }

    if (!Number.isInteger(year) || year < 2000 || year > 3000) {
      throw new AppError('year tidak valid', 400);
    }

    try {
      const report = await AccountingReportService.getPayrollReport(
        tenantId,
        month,
        year,
        branchId,
      );

      return res.status(200).json({
        success: true,
        data: sanitizeAccountingJsonValue(report),
      });
    } catch (error) {
      rethrowAccountingReportError(error);
    }
  },
);

export default {
  getProfitAndLossReport,
  getBalanceSheetReport,
  getPayrollReport,
};