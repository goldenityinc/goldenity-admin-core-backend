import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { ExpenseService } from '../services/expenseService';
import { createExpenseSchema, updateExpenseSchema } from '../validations/expenseValidation';
import { serializeForJson } from '../utils/serializeForJson';
import { uploadToS3 } from '../utils/s3Uploader';

function inferImageExtension(mimeType: string): string | null {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  return null;
}

async function resolveExpenseAttachmentUrl(req: Request): Promise<string | undefined> {
  const existingUrl = (req.body?.attachment_url ?? req.body?.attachmentUrl ?? '').toString().trim();
  const file = req.file as Express.Multer.File | undefined;

  if (!file) {
    return existingUrl || undefined;
  }

  if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
    throw new AppError('Lampiran pengeluaran harus berupa gambar', 400);
  }

  const extension = inferImageExtension(file.mimetype);
  if (!extension) {
    throw new AppError('Format lampiran pengeluaran tidak didukung', 400);
  }

  const fileName = `expenses/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const uploaded = await uploadToS3(file.buffer, fileName, file.mimetype);
  return uploaded.url;
}

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

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(`Date is not valid: ${value}`, 400);
  }
  return d;
}

/**
 * POST /api/v1/expenses
 * Create a new expense record
 * 
 * Captures: title, category, expense_date, amount, notes, status from request body
 * Ensures frontend data is used, NOT hardcoded defaults
 */
export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createExpenseSchema.safeParse(req.body);

  if (!parsed.success) {
    console.error('[createExpense] Validation failed:', parsed.error.issues);
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid expense payload', 400);
  }

  try {
    const attachmentUrl = await resolveExpenseAttachmentUrl(req);
    const expense = await ExpenseService.createExpense(readTenantId(req), {
      ...parsed.data,
      ...(attachmentUrl !== undefined ? { attachment_url: attachmentUrl } : {}),
    });

    console.log(
      `[createExpense] Expense created successfully. ID=${expense.id}, Title="${expense.title}", TenantId=${readTenantId(req)}`
    );

    return res.status(201).json({
      success: true,
      message: 'Pengeluaran berhasil dibuat',
      data: serializeForJson(expense),
    });
  } catch (error) {
    console.error('[createExpense] Error creating expense:', error);
    throw error;
  }
});

/**
 * GET /api/v1/expenses
 * List expenses with filters and pagination
 */
export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const startDate = parseOptionalDate(req.query.startDate);
  const endDate = parseOptionalDate(req.query.endDate);
  const category = (req.query.category ?? '').toString().trim() || undefined;
  const status = (req.query.status ?? '').toString().trim() || undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 50);

  const result = await ExpenseService.listExpenses({
    tenantId,
    startDate,
    endDate,
    category,
    status,
    page,
    limit,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(result.records),
    pagination: serializeForJson(result.pagination),
  });
});

/**
 * GET /api/v1/expenses/:id
 * Get a single expense by ID
 */
export const getExpense = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pengeluaran tidak valid', 400);
  }

  const expense = await ExpenseService.getExpenseById(tenantId, BigInt(rawId));

  if (!expense) {
    throw new AppError('Pengeluaran tidak ditemukan', 404);
  }

  return res.status(200).json({
    success: true,
    data: serializeForJson(expense),
  });
});

/**
 * PUT /api/v1/expenses/:id
 * Update an expense record
 */
export const updateExpense = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pengeluaran tidak valid', 400);
  }

  const parsed = updateExpenseSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid update payload', 400);
  }

  try {
    const attachmentUrl = await resolveExpenseAttachmentUrl(req);
    const expense = await ExpenseService.updateExpense(tenantId, BigInt(rawId), {
      ...parsed.data,
      ...(attachmentUrl !== undefined ? { attachment_url: attachmentUrl } : {}),
    });

    return res.status(200).json({
      success: true,
      message: 'Pengeluaran berhasil diperbarui',
      data: serializeForJson(expense),
    });
  } catch (error) {
    console.error('[updateExpense] Error updating expense:', error);
    throw error;
  }
});

/**
 * PATCH /api/v1/expenses/:id/void
 * Void (cancel) an expense record
 */
export const voidExpense = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pengeluaran tidak valid', 400);
  }

  const voidReason = (req.body?.void_reason ?? '').toString().trim() || undefined;

  try {
    const expense = await ExpenseService.voidExpense(tenantId, BigInt(rawId), voidReason);

    return res.status(200).json({
      success: true,
      message: 'Pengeluaran berhasil dibatalkan',
      data: serializeForJson(expense),
    });
  } catch (error) {
    console.error('[voidExpense] Error voiding expense:', error);
    throw error;
  }
});
