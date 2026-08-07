import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { ClientPaymentService } from '../services/clientPaymentService';
import {
  upsertClientPaymentCellSchema,
  matrixQuerySchema,
} from '../validations/clientPaymentValidation';
import { serializeForJson } from '../utils/serializeForJson';
import { uploadToS3 } from '../utils/s3Uploader';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  return tenantId;
}

function preParseReceiptImagesForValidation(body: Record<string, unknown>) {
  const raw = body.receipt_images ?? body.receiptImages;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw.trim());
      if (Array.isArray(parsed)) {
        body.receiptImages = parsed;
        return;
      }
    } catch {
      /* fall through */
    }
  }
  if (Array.isArray(raw)) {
    body.receiptImages = raw;
  }
}

function normalizeCellKeysForValidation(body: Record<string, unknown>) {
  const keyMap: Record<string, string> = {
    client_id: 'clientId',
    customer_id: 'clientId',
    product_id: 'productId',
    period_month: 'periodMonth',
    period_year: 'periodYear',
    payment_status: 'status',
    receipt_images: 'receiptImages',
  };

  for (const [snake, camel] of Object.entries(keyMap)) {
    if (body[snake] !== undefined && body[camel] === undefined) {
      body[camel] = body[snake];
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

async function resolveReceiptImages(req: Request): Promise<string[]> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  const raw = req.body?.receiptImages ?? req.body?.receipt_images;
  let bodyImages: string[] = [];

  if (Array.isArray(raw)) {
    bodyImages = raw.map((item: unknown) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          bodyImages = parsed.map((item: unknown) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
        }
      } catch {
        bodyImages = [trimmed];
      }
    }
  }

  const uploadedUrls: string[] = [];
  for (const file of files) {
    if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
      throw new AppError('Lampiran nota pembayaran harus berupa gambar', 400);
    }
    const extension = inferImageExtension(file.mimetype);
    if (!extension) {
      throw new AppError('Format lampiran nota pembayaran tidak didukung', 400);
    }
    const fileName = `client-payments/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const uploaded = await uploadToS3(file.buffer, fileName, file.mimetype);
    uploadedUrls.push(uploaded.url);
  }

  return [...bodyImages, ...uploadedUrls];
}

export const listMatrix = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);

  const parsed = matrixQuerySchema.safeParse({
    year: req.query.year,
    productId: req.query.productId,
  });

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid matrix query params', 400);
  }

  const productId = parsed.data.productId
    ? parsed.data.productId.toString()
    : undefined;

  const isSuperAdmin = true;

  const [matrix, refs] = await Promise.all([
    ClientPaymentService.getMatrix(tenantId, parsed.data.year, productId),
    ClientPaymentService.listClientsAndProducts(tenantId, { isSuperAdmin }),
  ]);

  return res.status(200).json({
    success: true,
    data: serializeForJson(matrix),
    references: serializeForJson(refs),
  });
});

export const getCell = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawId = req.params.id;

  if (!rawId || !/^\d+$/.test(rawId)) {
    throw new AppError('ID cell pembayaran tidak valid', 400);
  }

  const cell = await ClientPaymentService.getCellById(tenantId, BigInt(rawId));

  if (!cell) {
    throw new AppError('Cell pembayaran tidak ditemukan', 404);
  }

  return res.status(200).json({
    success: true,
    data: serializeForJson(cell),
  });
});

export const upsertCell = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);

  if (req.body && typeof req.body === 'object') {
    const body = req.body as Record<string, unknown>;
    normalizeCellKeysForValidation(body);
    preParseReceiptImagesForValidation(body);
  }

  console.log('[upsertCell] req.body after normalize:', JSON.stringify(req.body, null, 2));

  const parsed = upsertClientPaymentCellSchema.safeParse(req.body);

  if (!parsed.success) {
    console.error('[upsertCell] Validation failed:', JSON.stringify(parsed.error.issues, null, 2));
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid upsert payload', 400);
  }

  try {
    const resolvedReceiptImages = await resolveReceiptImages(req);
    if (resolvedReceiptImages.length > 0) {
      parsed.data.receiptImages = resolvedReceiptImages;
    }

    const cell = await ClientPaymentService.upsertCell(tenantId, parsed.data);

    console.log(
      `[upsertCell] Cell upserted successfully. ID=${cell.id}, TenantId=${tenantId}`
    );

    return res.status(200).json({
      success: true,
      message: 'Cell pembayaran berhasil disimpan',
      data: serializeForJson(cell),
    });
  } catch (error) {
    console.error('[upsertCell] Error upserting cell:', error);
    throw error;
  }
});
