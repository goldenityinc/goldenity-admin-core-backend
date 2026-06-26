import bcrypt from 'bcryptjs';
import { BusinessCategory, UserRole } from '@prisma/client';
import prisma from '../config/database';

export class TenantService {
  static async createTenant(data: {
    name: string;
    branchName?: string;
    firstBranchName?: string;
    slug?: string;
    email?: string;
    phone?: string;
    address?: string;
    logoUrl?: string;
    qrisImageUrl?: string;
    allowPayAtCashier?: boolean;
    enableQrisOcr?: boolean;
    adminEmail?: string;
    adminPassword?: string;
    businessCategory?: BusinessCategory;
    isActive?: boolean;
    showInventoryImages?: boolean;
  }) {
    const resolvedSlug = data.slug ?? this.generateSlug(data.name);
    const firstBranchName = data.firstBranchName ?? data.branchName ?? 'Cabang Utama';
    const defaultBranchCode = `${resolvedSlug.toUpperCase()}-01`;

    const shouldCreateFirstAdmin = Boolean(data.adminEmail && data.adminPassword);
    const passwordHash = shouldCreateFirstAdmin
      ? await bcrypt.hash(data.adminPassword as string, 10)
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: resolvedSlug,
          email: data.email,
          phone: data.phone,
          address: data.address,
          businessCategory: data.businessCategory ?? 'GENERAL',
          logoUrl: data.logoUrl,
          qrisImageUrl: data.qrisImageUrl,
          allowPayAtCashier: data.allowPayAtCashier ?? true,
          enableQrisOcr: data.enableQrisOcr ?? true,
          isActive: data.isActive ?? true,
          showInventoryImages: data.showInventoryImages ?? true,
          branches: {
            create: [
              {
                name: firstBranchName,
                branchCode: defaultBranchCode,
                isMainBranch: true,
                isActive: true,
              },
            ],
          },
        },
      });

      if (!shouldCreateFirstAdmin) {
        return { tenant, firstAdmin: null };
      }

      const firstAdmin = await tx.user.create({
        data: {
          email: data.adminEmail as string,
          name: `${data.name} Admin`,
          role: UserRole.TENANT_ADMIN,
          tenantId: tenant.id,
          isActive: true,
          firebaseUid: null,
          passwordHash: passwordHash as string,
        },
      });

      return { tenant, firstAdmin };
    });

    return {
      tenant: result.tenant,
      firstAdmin: result.firstAdmin
        ? {
            id: result.firstAdmin.id,
            email: result.firstAdmin.email,
            role: result.firstAdmin.role,
          }
        : null,
    };
  }

  static async getTenantById(tenantId: string) {
    return await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
  }

  static async listTenants(options: { page: number; limit: number; search?: string }) {
    const skip = (options.page - 1) * options.limit;
    const where = options.search
      ? {
          OR: [
            { name: { contains: options.search, mode: 'insensitive' as const } },
            { slug: { contains: options.search, mode: 'insensitive' as const } },
            { email: { contains: options.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take: options.limit,
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          address: true,
          logoUrl: true,
          qrisImageUrl: true,
          allowPayAtCashier: true,
          enableQrisOcr: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          showInventoryImages: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.tenant.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / options.limit)),
      },
    };
  }

  private static generateSlug(name: string) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }
}
