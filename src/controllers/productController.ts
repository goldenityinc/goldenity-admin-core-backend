import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { ProductService } from '../services/productService';
import { resolveBranchFilter } from '../utils/branchIsolation';
import { updateProductSchema } from '../validations/productValidation';
import { serializeForJson } from '../utils/serializeForJson';
import { ObjectStorageService } from '../services/objectStorageService';
import { AuditLogService } from '../services/auditLogService';

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

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function parseQueryBranchId(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return null;
  }

  return BigInt(value);
}

function inferImageExtension(mimeType: string): string | null {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/svg+xml') return 'svg';
  return null;
}

function resolveProductBranchFilter(req: Request): bigint | null {
  const user = req.user;
  if (!user) {
    throw new AppError('Unauthenticated', 401);
  }

  const role = (user.role ?? '').trim().toUpperCase();

  if (role === 'TENANT_ADMIN') {
    return parseQueryBranchId(req.query.branchId);
  }

  if (role === 'CASHIER' || role === 'CRM_STAFF') {
    if (!user.branchId) {
      throw new AppError('Akses ditolak: konteks cabang tidak tersedia pada akun ini', 403);
    }

    if (!/^\d+$/.test(user.branchId)) {
      throw new AppError('Branch ID pada token tidak valid', 403);
    }

    return BigInt(user.branchId);
  }

  return resolveBranchFilter(req);
}

/**
 * GET /api/v1/products
 *
 * Branch filter is resolved from JWT/query via resolveBranchFilter.
 * - CASHIER / CRM_STAFF: wajib branch scope
 * - TENANT_ADMIN + HQ: boleh lintas cabang
 */
export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = resolveProductBranchFilter(req);

  const isActive = parseOptionalBoolean(req.query.isActive);
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 100);

  const result = await ProductService.listProducts({
    tenantId,
    branchId,
    isActive,
    category,
    search,
    page,
    limit,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(result.products),
    pagination: result.pagination,
  });
});

/**
 * GET /api/v1/products/:productId
 */
export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = resolveProductBranchFilter(req);

  const { productId } = req.params;
  if (!productId || typeof productId !== 'string') {
    throw new AppError('Product ID tidak valid', 400);
  }

  const product = await ProductService.getProductById(
    tenantId,
    productId,
    branchId,
  );

  if (!product) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  return res.status(200).json({
    success: true,
    data: serializeForJson(product),
  });
});

/**
 * PATCH /api/v1/products/:id
 */
export const updateProductBranch = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const role = (req.user?.role ?? '').trim().toUpperCase();

  if (role !== 'TENANT_ADMIN') {
    throw new AppError('Akses ditolak: hanya TENANT_ADMIN yang dapat mengubah cabang produk', 403);
  }

  const productId = req.params.id;
  if (!productId || typeof productId !== 'string') {
    throw new AppError('Product ID tidak valid', 400);
  }

  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid payload', 400);
  }

  const branchIdRaw = parsed.data.branchId ?? parsed.data.branch_id;
  const isAvailableRaw = parsed.data.is_available ?? parsed.data.isAvailable;
  const isActiveRaw = parsed.data.is_active ?? parsed.data.isActive;

  const updatePayload = {
    ...(branchIdRaw !== undefined
      ? {
          branchId:
            branchIdRaw === null ? null : BigInt(branchIdRaw),
        }
      : {}),
    ...(isAvailableRaw !== undefined ? { is_available: Boolean(isAvailableRaw) } : {}),
    ...(isActiveRaw !== undefined ? { is_active: Boolean(isActiveRaw) } : {}),
  };

  if (Object.keys(updatePayload).length === 0) {
    throw new AppError('Tidak ada field yang dapat diubah', 400);
  }

  const updated = await ProductService.updateProductFields(
    tenantId,
    productId,
    updatePayload,
  );

  if (!updated) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  await AuditLogService.createLog({
    tenantId,
    userId: req.user?.userId,
    userName: req.user?.email,
    actionType: 'PRODUCT_UPDATED',
    details: `Produk ${productId} diperbarui`,
  });

  return res.status(200).json({
    success: true,
    message: 'Produk berhasil diperbarui',
    data: updated,
  });
});

/**
 * POST /api/v1/products/:id/image
 */
export const uploadProductImage = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const role = (req.user?.role ?? '').trim().toUpperCase();

  if (role !== 'TENANT_ADMIN') {
    throw new AppError('Akses ditolak: hanya TENANT_ADMIN yang dapat mengunggah foto produk', 403);
  }

  const productId = (req.params.id ?? '').toString().trim();
  if (!productId) {
    throw new AppError('Product ID tidak valid', 400);
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    throw new AppError('File gambar wajib diupload (field: file)', 400);
  }

  if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
    throw new AppError('File harus berupa gambar', 400);
  }

  const ext = inferImageExtension(file.mimetype);
  if (!ext) {
    throw new AppError('Format gambar tidak didukung (png/jpg/webp/svg)', 400);
  }

  const key = `products/${tenantId}/${productId}/image-${Date.now()}.${ext}`;
  const uploaded = await ObjectStorageService.putPublicObject({
    key,
    body: file.buffer,
    contentType: file.mimetype,
  });

  const updated = await ProductService.updateProductFields(tenantId, productId, {
    image_url: uploaded.url,
  });

  if (!updated) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  return res.status(200).json({
    success: true,
    message: 'Foto produk berhasil diupload',
    data: {
      id: updated.id,
      image_url: updated.image_url,
      imageUrl: updated.image_url,
    },
  });
});
