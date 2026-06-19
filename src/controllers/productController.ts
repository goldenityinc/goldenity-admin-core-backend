import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { ProductService } from '../services/productService';
import { resolveBranchFilter } from '../utils/branchIsolation';
import { createProductSchema, updateProductSchema } from '../validations/productValidation';
import { serializeForJson } from '../utils/serializeForJson';
import { ObjectStorageService } from '../services/objectStorageService';
import { AuditLogService } from '../services/auditLogService';
import prisma from '../config/database';

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

function parseOptionalBigIntLike(value: unknown): bigint | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = value.toString().trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  return BigInt(normalized);
}

async function resolveProductCategoryName(
  tenantId: string,
  rawCategoryId: unknown,
  rawCategoryName: unknown,
): Promise<string | null> {
  const directName = (rawCategoryName ?? '').toString().trim();
  if (directName.length > 0) {
    const existingCategory = await prisma.categories.findFirst({
      where: {
        tenant_id: tenantId,
        name: {
          equals: directName,
          mode: 'insensitive',
        },
      },
      select: { id: true },
    });

    if (!existingCategory) {
      await prisma.categories.create({
        data: {
          tenant_id: tenantId,
          name: directName,
          category_type: 'PRODUCT',
        },
      });
    }

    return directName;
  }

  const categoryId = parseOptionalBigIntLike(rawCategoryId);
  if (categoryId == null) {
    return null;
  }

  const byId = await prisma.categories.findFirst({
    where: {
      id: categoryId,
      tenant_id: tenantId,
    },
    select: { name: true },
  });
  return byId?.name?.trim() || null;
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
 * POST /api/v1/products
 */
export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const role = (req.user?.role ?? '').trim().toUpperCase();
  if (role !== 'TENANT_ADMIN') {
    throw new AppError('Akses ditolak: hanya TENANT_ADMIN yang dapat menambah produk', 403);
  }

  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid payload', 400);
  }

  const body = parsed.data;
  const now = Date.now();
  const productId =
    (body.id ?? '').toString().trim() ||
    `prod_${now}_${Math.floor(Math.random() * 1000)}`;

  const branchId =
    parseOptionalBigIntLike(body.branchId ?? body.branch_id) ??
    parseOptionalBigIntLike(req.user?.branchId);
  const categoryName = await resolveProductCategoryName(
    tenantId,
    body.categoryId ?? body.category_id,
    body.category,
  );
  const purchasePrice = body.purchasePrice ?? body.purchase_price;
  const isService = body.isService ?? body.is_service ?? false;

  const created = await ProductService.createProduct({
    id: productId,
    tenantId,
    branchId,
    name: body.name,
    product_type: isService ? 'Jasa' : 'Barang',
    barcode: body.barcode ?? null,
    category: categoryName,
    price: body.price ?? 0,
    purchase_price: isService ? 0 : purchasePrice ?? null,
    stock: isService ? 0 : body.stock ?? 0,
    is_available: true,
    is_service: isService,
    supplier_name: body.supplierName ?? body.supplier_name ?? null,
    image_url: body.imageUrl ?? body.image_url ?? null,
    is_active: body.isActive ?? body.is_active ?? true,
    reference_id: body.referenceId ?? body.reference_id ?? null,
  });

  await AuditLogService.createLog({
    tenantId,
    userId: req.user?.userId,
    userName: req.user?.email,
    actionType: 'PRODUCT_CREATED',
    details: `Produk ${created.id} dibuat`,
  });

  return res.status(201).json({
    success: true,
    message: 'Produk berhasil dibuat',
    data: serializeForJson(created),
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
