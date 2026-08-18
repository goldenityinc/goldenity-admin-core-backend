import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { IncomeService } from '../services/incomeService';
import {
  createIncomeSchema,
  updateIncomeSchema,
  setPaymentStatusSchema,
} from '../validations/incomeValidation';
import { serializeForJson } from '../utils/serializeForJson';
import { uploadToS3 } from '../utils/s3Uploader';

type ParsedAttachment = {
  url: string;
  caption?: string;
};

function preParseAttachmentsForValidation(body: Record<string, unknown>) {
  const raw = body.attachments;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw.trim());
      if (Array.isArray(parsed)) {
        body.attachments = parsed;
      }
    } catch {
      /* leave as-is; validation will either ignore or reject gracefully */
    }
  }
}

function inferImageExtension(mimeType: string): string | null {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  return null;
}

async function resolveIncomeAttachments(req: Request): Promise<ParsedAttachment[]> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  const bodyAttachmentsRaw =
    req.body?.attachments ?? req.body?.attachment_url ?? req.body?.attachmentUrl ?? '';

  let parsedBodyAttachments: ParsedAttachment[] = [];
  if (bodyAttachmentsRaw) {
    if (typeof bodyAttachmentsRaw === 'string') {
      const trimmed = bodyAttachmentsRaw.trim();
      if (trimmed.length > 0) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            parsedBodyAttachments = parsed.map((item: unknown) => {
              if (typeof item === 'string') {
                return { url: item };
              }
              if (item && typeof item === 'object') {
                const obj = item as Record<string, unknown>;
                return {
                  url: String(obj.url ?? '').trim(),
                  caption: obj.caption !== undefined ? String(obj.caption).trim() : undefined,
                };
              }
              return { url: '' };
            }).filter((att: ParsedAttachment) => att.url.length > 0);
          } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
            parsedBodyAttachments = [{ url: parsed.trim() }];
          }
        } catch {
          const url = trimmed.toString().trim();
          if (url.length > 0 && /^https?:\/\//i.test(url)) {
            parsedBodyAttachments = [{ url }];
          }
        }
      }
    } else if (Array.isArray(bodyAttachmentsRaw)) {
      parsedBodyAttachments = bodyAttachmentsRaw.map((item: unknown) => {
        if (typeof item === 'string') {
          return { url: item };
        }
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          return {
            url: String(obj.url ?? '').trim(),
            caption: obj.caption !== undefined ? String(obj.caption).trim() : undefined,
          };
        }
        return { url: '' };
      }).filter((att: ParsedAttachment) => att.url.length > 0);
    }
  }

  const legacyAttachmentUrl = (req.body?.attachment_url ?? req.body?.attachmentUrl ?? '')
    .toString()
    .trim();
  if (
    legacyAttachmentUrl.length > 0 &&
    !parsedBodyAttachments.some((att) => att.url === legacyAttachmentUrl)
  ) {
    parsedBodyAttachments.push({ url: legacyAttachmentUrl });
  }

  const uploadedAttachments: ParsedAttachment[] = [];
  for (const file of files) {
    if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
      throw new AppError('Lampiran pemasukan harus berupa gambar', 400);
    }

    const extension = inferImageExtension(file.mimetype);
    if (!extension) {
      throw new AppError('Format lampiran pemasukan tidak didukung', 400);
    }

    const originalName = (file.originalname ?? 'attachment').replace(/\.[^.]+$/, '');
    const fileName = `incomes/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const uploaded = await uploadToS3(file.buffer, fileName, file.mimetype);
    uploadedAttachments.push({
      url: uploaded.url,
      caption: originalName || undefined,
    });
  }

  return [...parsedBodyAttachments, ...uploadedAttachments];
}

/**
 * Resolve tenant context for income operations.
 * - SUPER_ADMIN may provide tenantId override via query/body to target a specific tenant,
 *   or omit it entirely to operate in "global" mode (tenant_id = NULL on create,
 *   and no tenant filtering on list/get).
 * - Regular tenant-scoped roles are always resolved from the JWT tenantId and are required.
 */
function readTenantId(req: Request): string | null {
  if (req.user?.role === 'SUPER_ADMIN') {
    const override = String(req.query.tenantId ?? req.body?.tenantId ?? '').trim();
    if (override) return override;
    return null;
  }
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

export const createIncome = asyncHandler(async (req: Request, res: Response) => {
  if (req.body && typeof req.body === 'object') {
    preParseAttachmentsForValidation(req.body as Record<string, unknown>);
  }
  const parsed = createIncomeSchema.safeParse(req.body);

  if (!parsed.success) {
    console.error('[createIncome] Validation failed:', parsed.error.issues);
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid income payload', 400);
  }

  try {
    const attachments = await resolveIncomeAttachments(req);
    const income = await IncomeService.createIncome(readTenantId(req), {
      ...parsed.data,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    console.log(
      `[createIncome] Income created successfully. ID=${income.id}, Title="${income.title}", PaymentStatus=${income.payment_status}, Attachments=${income.attachments?.length ?? 0}, TenantId=${readTenantId(req)}`
    );

    return res.status(201).json({
      success: true,
      message: 'Pemasukan berhasil dibuat',
      data: serializeForJson(income),
    });
  } catch (error) {
    console.error('[createIncome] Error creating income:', error);
    throw error;
  }
});

export const listIncomes = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const startDate = parseOptionalDate(req.query.startDate);
  const endDate = parseOptionalDate(req.query.endDate);
  const category = (req.query.category ?? '').toString().trim() || undefined;
  const status = (req.query.status ?? '').toString().trim() || undefined;
  const payment_status = (req.query.payment_status ?? '').toString().trim() || undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 50);

  const result = await IncomeService.listIncomes({
    tenantId,
    startDate,
    endDate,
    category,
    status,
    payment_status,
    page,
    limit,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(result.records),
    pagination: serializeForJson(result.pagination),
  });
});

export const getIncome = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pemasukan tidak valid', 400);
  }

  const income = await IncomeService.getIncomeById(tenantId, BigInt(rawId));

  if (!income) {
    throw new AppError('Pemasukan tidak ditemukan', 404);
  }

  return res.status(200).json({
    success: true,
    data: serializeForJson(income),
  });
});

export const updateIncome = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pemasukan tidak valid', 400);
  }

  if (req.body && typeof req.body === 'object') {
    preParseAttachmentsForValidation(req.body as Record<string, unknown>);
  }
  const parsed = updateIncomeSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid update payload', 400);
  }

  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const hasAttachmentInput =
      req.body?.attachments !== undefined ||
      req.body?.attachment_url !== undefined ||
      req.body?.attachmentUrl !== undefined ||
      files.length > 0;

    const attachments = hasAttachmentInput
      ? await resolveIncomeAttachments(req)
      : undefined;

    const income = await IncomeService.updateIncome(tenantId, BigInt(rawId), {
      ...parsed.data,
      ...(attachments !== undefined ? { attachments } : {}),
    });

    return res.status(200).json({
      success: true,
      message: 'Pemasukan berhasil diperbarui',
      data: serializeForJson(income),
    });
  } catch (error) {
    console.error('[updateIncome] Error updating income:', error);
    throw error;
  }
});

export const voidIncome = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pemasukan tidak valid', 400);
  }

  const voidReason = (req.body?.void_reason ?? '').toString().trim() || undefined;

  try {
    const income = await IncomeService.voidIncome(tenantId, BigInt(rawId), voidReason);

    return res.status(200).json({
      success: true,
      message: 'Pemasukan berhasil dibatalkan',
      data: serializeForJson(income),
    });
  } catch (error) {
    console.error('[voidIncome] Error voiding income:', error);
    throw error;
  }
});

export const setPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pemasukan tidak valid', 400);
  }

  const parsed = setPaymentStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(
      parsed.error.issues[0]?.message ?? 'Invalid payment status payload',
      400
    );
  }

  try {
    const income = await IncomeService.setPaymentStatus(
      tenantId,
      BigInt(rawId),
      parsed.data
    );

    return res.status(200).json({
      success: true,
      message: `Status pembayaran pemasukan berhasil diubah menjadi ${parsed.data.payment_status}`,
      data: serializeForJson(income),
    });
  } catch (error) {
    console.error('[setPaymentStatus] Error updating payment status:', error);
    throw error;
  }
});

export const deleteIncome = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID pemasukan tidak valid', 400);
  }

  try {
    await IncomeService.deleteIncome(tenantId, BigInt(rawId));

    return res.status(200).json({
      success: true,
      message: 'Pemasukan berhasil dihapus permanen',
    });
  } catch (error) {
    console.error('[deleteIncome] Error deleting income:', error);
    throw error;
  }
});
