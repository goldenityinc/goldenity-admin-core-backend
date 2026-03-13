import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
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
      const createdUser = await prisma.user.create({
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

      // Best-effort: provision credentials into the tenant's POS database so the
      // user can immediately authenticate via /auth/login on the POS app.
      await UserService.syncToTenantPosDb(
        tenantId,
        data.username,
        passwordHash,
        data.role ?? 'TENANT_ADMIN',
      );

      return createdUser;
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
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    // Best-effort: keep the POS tenant DB in sync with the new password hash.
    if (updatedUser.username) {
      await UserService.syncToTenantPosDb(
        updatedUser.tenantId,
        updatedUser.username,
        passwordHash,
        updatedUser.role,
      );
    }

    return updatedUser;
  }

  /**
   * Upserts a user's credentials into the tenant's POS database (app_users table).
   * Failures are logged and swallowed so they never roll back the master-DB operation.
   */
  static async syncToTenantPosDb(
    tenantId: string,
    username: string,
    passwordHash: string,
    role: string,
  ): Promise<void> {
    const appInstance = await prisma.appInstance.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      select: { dbConnectionString: true },
    });

    if (!appInstance?.dbConnectionString) {
      // No active app instance with a DB URL yet — skip silently.
      return;
    }

    const client = new Client({
      connectionString: appInstance.dbConnectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();

      const existing = await client.query<{ id: number }>(
        'SELECT id FROM app_users WHERE username = $1 LIMIT 1',
        [username],
      );

      if (existing.rowCount && existing.rowCount > 0) {
        await client.query(
          'UPDATE app_users SET password = $1, role = $2 WHERE username = $3',
          [passwordHash, role, username],
        );
      } else {
        await client.query(
          'INSERT INTO app_users (username, password, role) VALUES ($1, $2, $3)',
          [username, passwordHash, role],
        );
      }
    } catch (error) {
      console.error(
        `[UserService] syncToTenantPosDb failed for user '${username}' (tenantId=${tenantId}):`,
        error,
      );
    } finally {
      await client.end().catch(() => undefined);
    }
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
