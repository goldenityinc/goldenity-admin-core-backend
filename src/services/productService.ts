import prisma from '../config/database';

/**
 * Service layer untuk Product
 * Berisi business logic untuk operasi product
 */
export class ProductService {
  /**
   * Get all products untuk tenant tertentu
   */
  static async getProductsByTenant(tenantId: string) {
    return await prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Create new product
   */
  static async createProduct(data: any, tenantId: string) {
    return await prisma.product.create({
      data: {
        ...data,
        tenantId, // Pastikan tenantId selalu ter-assign
      },
    });
  }

  /**
   * Get product by ID (dengan validasi tenantId)
   */
  static async getProductById(productId: string, tenantId: string) {
    return await prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
      },
    });
  }
}
