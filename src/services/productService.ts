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

export class ProductService {
  /**
  * List products scoped to the requesting user's tenant.
  * When branchId is provided, results are isolated to that branch at the product row level.
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

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.productsWhereInput = {
      tenant_id: tenantId,
      ...(branchId !== null ? { branchId } : {}),
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
    const product = await prisma.products.findFirst({
      where: {
        id: productId,
        tenant_id: tenantId,
        ...(branchId !== null ? { branchId } : {}),
      },
    });

    if (!product) {
      return null;
    }

    return product ?? null;
  }
}
