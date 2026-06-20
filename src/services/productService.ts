import { Prisma } from '@prisma/client';
import prisma from '../config/database';

export type ProductListFilters = {
  tenantId: string;
  branchId: bigint | null;
  isActive?: boolean;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type ProductUpdateFields = {
  branchId?: bigint | null;
  is_available?: boolean;
  is_active?: boolean;
  image_url?: string;
  name?: string;
  barcode?: string | null;
  category?: string | null;
  price?: number;
  purchase_price?: number | null;
  stock?: number;
};

export type ProductCreateInput = {
  id: string;
  tenantId: string;
  branchId?: bigint | null;
  name: string;
  product_type?: string;
  barcode?: string | null;
  category?: string | null;
  price?: number;
  purchase_price?: number | null;
  stock?: number;
  is_available?: boolean;
  is_service?: boolean;
  supplier_name?: string | null;
  image_url?: string | null;
  is_active?: boolean;
  reference_id?: string | null;
};

export class ProductService {
  private static assertTenantId(tenantId: string): string {
    const normalizedTenantId = (tenantId ?? '').toString().trim();
    if (!normalizedTenantId) {
      throw new Error('Security guard: tenantId wajib tersedia untuk operasi produk');
    }
    return normalizedTenantId;
  }

  /**
  * List products scoped to the requesting user's tenant.
  * branchId is never allowed to be null in result rows.
   */
  static async listProducts(filters: ProductListFilters) {
    const {
      tenantId,
      branchId,
      isActive,
      category,
      search,
      page = 1,
      limit = 100,
    } = filters;
    const normalizedTenantId = this.assertTenantId(tenantId);

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.productsWhereInput = {
      tenant_id: normalizedTenantId,
      ...(branchId !== null ? { branchId } : { branchId: { not: null } }),
      ...(isActive !== undefined ? { is_active: isActive } : {}),
      ...(category ? { category } : {}),
      ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
    };

    const [products, total] = await Promise.all([
      prisma.products.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: safeLimit,
        select: {
          id: true,
          branchId: true,
          tenant_id: true,
          name: true,
          product_type: true,
          barcode: true,
          category: true,
          price: true,
          purchase_price: true,
          stock: true,
          is_service: true,
          supplier_name: true,
          image_url: true,
          is_active: true,
          reference_id: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.products.count({ where }),
    ]);

    return {
      products,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Get a single product by ID, scoped to the requesting user's tenant.
   */
  static async getProductById(
    tenantId: string,
    productId: string,
    branchId: bigint | null,
  ) {
    const normalizedTenantId = this.assertTenantId(tenantId);
    const product = await prisma.products.findFirst({
      where: {
        id: productId,
        tenant_id: normalizedTenantId,
        ...(branchId !== null ? { branchId } : { branchId: { not: null } }),
      },
    });

    if (!product) {
      return null;
    }

    return product ?? null;
  }

  static async updateProductFields(
    tenantId: string,
    productId: string,
    fields: ProductUpdateFields,
  ) {
    const normalizedTenantId = this.assertTenantId(tenantId);
    const existing = await prisma.products.findFirst({
      where: {
        id: productId,
        tenant_id: normalizedTenantId,
      },
      select: { id: true },
    });

    if (!existing) {
      return null;
    }

    const data: Prisma.productsUpdateInput = {
      ...(fields.branchId !== undefined ? { branchId: fields.branchId } : {}),
      ...(fields.is_available !== undefined ? { is_available: fields.is_available } : {}),
      ...(fields.is_active !== undefined ? { is_active: fields.is_active } : {}),
      ...(fields.image_url !== undefined ? { image_url: fields.image_url } : {}),
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.barcode !== undefined ? { barcode: fields.barcode } : {}),
      ...(fields.category !== undefined ? { category: fields.category } : {}),
      ...(fields.price !== undefined ? { price: fields.price } : {}),
      ...(fields.purchase_price !== undefined ? { purchase_price: fields.purchase_price } : {}),
      ...(fields.stock !== undefined ? { stock: fields.stock } : {}),
    };

    if (Object.keys(data).length === 0) {
      return null;
    }

    return prisma.products.update({
      where: { id: productId },
      data,
    });
  }

  static async createProduct(input: ProductCreateInput) {
    const tenantId = this.assertTenantId(input.tenantId);

    return prisma.products.create({
      data: {
        id: input.id,
        tenant_id: tenantId,
        name: input.name,
        product_type: input.product_type ?? 'Barang',
        branchId: input.branchId,
        barcode: input.barcode ?? null,
        category: input.category ?? null,
        price: input.price ?? 0,
        purchase_price: input.purchase_price ?? null,
        stock: input.stock ?? 0,
        is_available: input.is_available ?? true,
        is_service: input.is_service ?? false,
        supplier_name: input.supplier_name ?? null,
        image_url: input.image_url ?? null,
        is_active: input.is_active ?? true,
        reference_id: input.reference_id ?? null,
      },
    });
  }

  static async deleteProduct(tenantId: string, productId: string): Promise<number> {
    const normalizedTenantId = this.assertTenantId(tenantId);
    const result = await prisma.products.deleteMany({
      where: {
        tenant_id: normalizedTenantId,
        id: productId,
      },
    });

    return result.count;
  }
}
