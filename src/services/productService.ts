import { Prisma } from '@prisma/client';
import prisma from '../config/database';

/**
 * NOTE on branch isolation:
 * The `products` table does not have a native `branch_id` column in this schema.
 * For branch-scoped callers, this service limits products to those that are linked
 * to the caller branch through sales records to prevent cross-branch data leakage.
 */

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
   * For branch-scoped callers, results are restricted to products that appear
   * in sales records for the same branch.
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

    if (branchId !== null) {
      const branchScopedIds = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT p.id
        FROM products p
        INNER JOIN sales_record_items sri ON sri.product_id = p.id
        INNER JOIN sales_records sr ON sr.id = sri.sales_record_id
        WHERE p.tenant_id = ${tenantId}
          AND sr.tenant_id = ${tenantId}
          AND sr.branch_id = ${branchId}
      `;

      const productIds = branchScopedIds
        .map((row) => (row.id ?? '').toString().trim())
        .filter((id) => id.length > 0);

      where.id = {
        in: productIds.length > 0 ? productIds : ['__no_branch_product_match__'],
      };
    }

    const [products, total] = await Promise.all([
      prisma.products.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: safeLimit,
        select: {
          id: true,
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
      },
    });

    if (!product) {
      return null;
    }

    if (branchId !== null) {
      const accessRows = await prisma.$queryRaw<Array<{ product_id: string }>>`
        SELECT sri.product_id
        FROM sales_record_items sri
        INNER JOIN sales_records sr ON sr.id = sri.sales_record_id
        WHERE sr.tenant_id = ${tenantId}
          AND sr.branch_id = ${branchId}
          AND sri.product_id = ${productId}
        LIMIT 1
      `;
      if (accessRows.length === 0) {
        return null;
      }
    }

    return product ?? null;
  }
}
