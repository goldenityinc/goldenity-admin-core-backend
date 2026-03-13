import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';

export class UserService {
  static async createTenantUser(data: {
    tenantId: string;
    username: string;
    password: string;
    name: string;
    role?: 'TENANT_ADMIN' | 'CRM_MANAGER' | 'CRM_STAFF' | 'READ_ONLY';
    isActive?: boolean;
  }) {
    const tenantId = data.tenantId;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    try {
      return await prisma.user.create({
        data: {
          username: data.username,
          passwordHash,
          firebaseUid: null,
          email: null,
          name: data.name,
          role: (data.role ?? 'TENANT_ADMIN') as UserRole,
          isActive: data.isActive ?? true,
          tenantId,
        },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      });
    } catch (error) {
      throw error;
    }
  }

  static async resetUserPassword(userId: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404);
    }
    if (user.role === 'SUPER_ADMIN') {
      throw new AppError('Cannot reset password for SUPER_ADMIN via this endpoint', 403);
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  static async listUsers(options: {
    page: number;
    limit: number;
    search?: string;
    tenantId?: string;
  }) {
    const skip = (options.page - 1) * options.limit;
    const where = {
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: 'insensitive' as const } },
              { email: { contains: options.search, mode: 'insensitive' as const } },
              { username: { contains: options.search, mode: 'insensitive' as const } },
              { firebaseUid: { contains: options.search, mode: 'insensitive' as const } },
              { tenant: { name: { contains: options.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: options.limit,
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
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

  static async listUsersByTenant(
    tenantId: string,
    options: { page: number; limit: number; search?: string }
  ) {
    return this.listUsers({
      page: options.page,
      limit: options.limit,
      search: options.search,
      tenantId,
    });
  }
}
