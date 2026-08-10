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
  stockLevel?: 'low' | 'out' | 'all' | 'tracked';
};

export type ProductUpdateFields = {
  branchId?: bigint | null;
  is_available?: boolean;
  is_active?: boolean;
  is_service?: boolean;
  is_stock_tracked?: boolean;
  image_url?: string;
  name?: string;
  product_type?: string;
  unit?: string;
  barcode?: string | null;
  category?: string | null;
  price?: number;
  purchase_price?: number | null;
  stock?: number | null;
};

export type ProductCreateInput = {
  id: string;
  tenantId: string;
  branchId?: bigint | null;
  name: string;
  unit?: string;
  product_type?: string;
  barcode?: string | null;
  category?: string | null;
  price?: number;
  purchase_price?: number | null;
  stock?: number;
  is_available?: boolean;
  is_service?: boolean;
  is_stock_tracked?: boolean;
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
      stockLevel = 'all',
    } = filters;
    const normalizedTenantId = this.assertTenantId(tenantId);

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.productsWhereInput = {
      tenant_id: normalizedTenantId,
      ...(branchId !== null ? { branchId } : {}),
      ...(isActive !== undefined ? { is_active: isActive } : {}),
      ...(category ? { category } : {}),
      ...(stockLevel === 'tracked' || stockLevel === 'low' || stockLevel === 'out'
        ? { is_stock_tracked: true }
        : {}),
      ...(stockLevel === 'low'
        ? {
            AND: [
              { stock: { not: null } },
              { stock: { gte: 1 } },
              { stock: { lte: 9 } },
            ],
          }
        : {}),
      ...(stockLevel === 'out'
        ? {
            AND: [
              { stock: { not: null } },
              { stock: { lte: 0 } },
            ],
          }
        : {}),
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
          unit: true,
          barcode: true,
          category: true,
          price: true,
          purchase_price: true,
          stock: true,
          is_stock_tracked: true,
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
      ...(fields.is_service !== undefined ? { is_service: fields.is_service } : {}),
      ...(fields.is_stock_tracked !== undefined ? { is_stock_tracked: fields.is_stock_tracked } : {}),
      ...(fields.image_url !== undefined ? { image_url: fields.image_url } : {}),
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.product_type !== undefined ? { product_type: fields.product_type } : {}),
      ...(fields.unit !== undefined ? { unit: fields.unit } : {}),
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
        unit: (input.unit ?? 'pcs').toString().trim() || 'pcs',
        branchId: input.branchId,
        barcode: input.barcode ?? null,
        category: input.category ?? null,
        price: input.price ?? 0,
        purchase_price: input.purchase_price ?? null,
        stock: input.stock ?? 0,
        is_stock_tracked: input.is_stock_tracked ?? true,
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

export async function ensureDefaultSeedProductsForTenant(tenantId: string): Promise<void> {
  const normalizedTenantId = (tenantId ?? '').toString().trim();
  if (!normalizedTenantId) return;
  try {
    const count = await prisma.products.count({ where: { tenant_id: normalizedTenantId } });
    if (count > 0) return;
    const DEFAULT_SEED_PRODUCTS = [
      { id: 'spp-bulanan', name: 'SPP Bulanan', price: 750000, product_type: 'Jasa', unit: 'bulan', is_service: true, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 0, stock: 0 },
      { id: 'uang-gedung', name: 'Uang Gedung', price: 5000000, product_type: 'Jasa', unit: 'paket', is_service: true, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 0, stock: 0 },
      { id: 'buku-paket', name: 'Buku Paket & Alat Tulis', price: 1250000, product_type: 'Barang', unit: 'paket', is_service: false, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 800000, stock: 0 },
      { id: 'seragam', name: 'Seragam Sekolah', price: 950000, product_type: 'Barang', unit: 'set', is_service: false, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 650000, stock: 0 },
      { id: 'kegiatan-osis', name: 'Kegiatan OSIS / Study Tour', price: 650000, product_type: 'Jasa', unit: 'kegiatan', is_service: true, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 0, stock: 0 },
      { id: 'uang-makan', name: 'Uang Makan / Catering', price: 450000, product_type: 'Jasa', unit: 'bulan', is_service: true, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 0, stock: 0 },
      { id: 'psb', name: 'PSB (Penerimaan Siswa Baru)', price: 2500000, product_type: 'Jasa', unit: 'paket', is_service: true, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 0, stock: 0 },
      { id: 'praktik-lab', name: 'Uang Praktik / Lab & UKK', price: 350000, product_type: 'Jasa', unit: 'semester', is_service: true, is_active: true, is_stock_tracked: false, is_available: true, purchase_price: 0, stock: 0 },
    ];
    const now = new Date();
    await Promise.all(
      DEFAULT_SEED_PRODUCTS.map((p) =>
        prisma.products.create({
          data: { ...p, tenant_id: normalizedTenantId, created_at: now, updated_at: now },
        }).catch(() => null)
      )
    );
  } catch { /* noop */ }
}

export async function ensureDefaultSeedClientsForTenant(tenantId: string): Promise<void> {
  const normalizedTenantId = (tenantId ?? '').toString().trim();
  if (!normalizedTenantId) return;
  try {
    const count = await prisma.customers.count({ where: { tenant_id: normalizedTenantId } });
    if (count > 0) return;
    const seed = [
      { id: 1001, name: 'SD Islam Al-Azhar', phone: '021-5550101', total_spent: 0 },
      { id: 1002, name: 'SMPK BPK PENABUR Jakarta', phone: '021-5550202', total_spent: 0 },
      { id: 1003, name: 'SMK Negeri 20 Bandung', phone: '022-5550303', total_spent: 0 },
      { id: 1004, name: 'SMA Negeri 1 Model Medan', phone: '061-5550404', total_spent: 0 },
      { id: 1005, name: 'TK Kartika Chandra Kirana', phone: '021-5550505', total_spent: 0 },
      { id: 1006, name: 'MI Plus Roudlotul Jannah', phone: '031-5550606', total_spent: 0 },
      { id: 1007, name: 'SMAN Plus Unggulan Aceh', phone: '0651-5550707', total_spent: 0 },
      { id: 1008, name: 'MA Negeri Program Keagamaan', phone: '0271-5550808', total_spent: 0 },
    ];
    const now = new Date();
    await Promise.all(
      seed.map((c) =>
        prisma.customers.create({ data: { ...c, tenant_id: normalizedTenantId, created_at: now, updated_at: now } }).catch(() => null)
      )
    );
  } catch { /* noop */ }
}

