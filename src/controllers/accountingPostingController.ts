import type { Request, Response } from 'express';
import AccountingPostingService from '../services/accountingPostingService';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';

function readStringField(body: unknown, key: string): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return '';
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

export const autoPostSalesJournal = asyncHandler(
  async (req: Request, res: Response) => {
    const salesTransactionId = readStringField(req.body, 'salesTransactionId');
    const tenantId = readStringField(req.body, 'tenantId');

    if (!salesTransactionId || !tenantId) {
      throw new AppError('salesTransactionId dan tenantId wajib diisi', 400);
    }

    const entry = await AccountingPostingService.postSalesToJournal(
      salesTransactionId,
      tenantId,
    );

    return res.status(200).json({
      success: true,
      message: 'Sales journal posted',
      data: entry,
    });
  },
);

export const autoPostExpenseJournal = asyncHandler(
  async (req: Request, res: Response) => {
    const expenseTransactionId = readStringField(req.body, 'expenseTransactionId');
    const tenantId = readStringField(req.body, 'tenantId');

    if (!expenseTransactionId || !tenantId) {
      throw new AppError('expenseTransactionId dan tenantId wajib diisi', 400);
    }

    const entry = await AccountingPostingService.postExpenseToJournal(
      expenseTransactionId,
      tenantId,
    );

    return res.status(200).json({
      success: true,
      message: 'Expense journal posted',
      data: entry,
    });
  },
);