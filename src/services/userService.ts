import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';

type PosSyncResult = {
  synced: boolean;
  reason?: string;
};

type PosSyncSummary = {
  tenantId: string;
  totalUsers: number;
  syncedUsers: number;
  skippedUsers: number;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function isRoleConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('invalid input value for enum') ||
    message.includes('violates check constraint') ||
    message.includes('violates not-null constraint')
  );
}

function getRoleCandidates(role: string): string[] {
  const normalized = role.trim().toUpperCase();

  const mapped: Record<string, string[]> = {
    SUPER_ADMIN: ['OWNER', 'ADMIN', 'SUPER_ADMIN'],
    TENANT_ADMIN: ['ADMIN', 'OWNER', 'TENANT_ADMIN', 'MANAGER'],
    CRM_MANAGER: ['MANAGER', 'ADMIN', 'STAFF'],
    CRM_STAFF: ['STAFF', 'CASHIER', 'KASIR', 'USER'],
    READ_ONLY: ['VIEWER', 'AUDITOR', 'READ_ONLY', 'STAFF'],
  };

  const baseCandidates = mapped[normalized] ?? [normalized, 'STAFF'];
  const expanded = baseCandidates.flatMap((candidate) => {
    const lower = candidate.toLowerCase();
    return lower === candidate ? [candidate] : [candidate, lower];
  });

  return [...new Set(expanded)];
}

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
      const syncResult = await UserService.syncToTenantPosDb(
        tenantId,
        data.username,
        passwordHash,
        data.role ?? 'TENANT_ADMIN',
        data.isActive ?? true,
      );

      if (!syncResult.synced) {
        console.warn(
          `[UserService] createTenantUser: provisioning POS belum berhasil (tenantId=${tenantId}, username=${data.username}, reason=${syncResult.reason ?? 'unknown'}).`,
        );
      }

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
      const syncResult = await UserService.syncToTenantPosDb(
        updatedUser.tenantId,
        updatedUser.username,
        passwordHash,
        updatedUser.role,
        updatedUser.isActive,
      );

      if (!syncResult.synced) {
        console.warn(
          `[UserService] resetUserPassword: sync POS gagal (tenantId=${updatedUser.tenantId}, username=${updatedUser.username}, reason=${syncResult.reason ?? 'unknown'}).`,
        );
      }
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
    isActive: boolean,
  ): Promise<PosSyncResult> {
    const appInstance = await prisma.appInstance.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      select: { dbConnectionString: true },
    });

    const tenantDbConnectionString = appInstance?.dbConnectionString?.trim();
    const masterDbConnectionString = process.env.DATABASE_URL?.trim();

    if (!tenantDbConnectionString) {
      console.warn(
        `[UserService] Gagal sync: dbConnectionString tenant tidak ditemukan (tenantId=${tenantId}).`,
      );

      if (!masterDbConnectionString) {
        console.warn(
          `[UserService] Sinkronisasi POS dilewati: DATABASE_URL (Master DB) juga tidak tersedia (tenantId=${tenantId}, username=${username}).`,
        );
        return { synced: false, reason: 'no_tenant_or_master_db_url' };
      }

      console.warn(
        `[UserService] Fallback ke Master DB (single DB mode) untuk sync user POS (tenantId=${tenantId}, username=${username}).`,
      );
    }

    const resolvedConnectionString = tenantDbConnectionString ?? masterDbConnectionString;

    if (!resolvedConnectionString) {
      return { synced: false, reason: 'no_connection_string' };
    }

    const client = new Client({
      connectionString: resolvedConnectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      const roleCandidates = getRoleCandidates(role);
      await UserService.upsertPosUser(client, {
        username,
        passwordHash,
        roleCandidates,
        isActive,
      });

      return { synced: true };
    } catch (error) {
      console.error(
        `[UserService] syncToTenantPosDb failed for user '${username}' (tenantId=${tenantId}):`,
        error,
      );
      return { synced: false, reason: 'query_error' };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  static async syncTenantUsersToPos(tenantId: string): Promise<PosSyncSummary> {
    const users = await prisma.user.findMany({
      where: {
        tenantId,
        username: { not: null },
        role: { not: UserRole.SUPER_ADMIN },
      },
      select: {
        username: true,
        passwordHash: true,
        role: true,
        isActive: true,
      },
    });

    let syncedUsers = 0;
    let skippedUsers = 0;

    for (const user of users) {
      const username = user.username?.trim();
      const passwordHash = user.passwordHash?.trim();

      if (!username || !passwordHash) {
        skippedUsers += 1;
        continue;
      }

      const result = await UserService.syncToTenantPosDb(
        tenantId,
        username,
        passwordHash,
        user.role,
        user.isActive,
      );

      if (result.synced) {
        syncedUsers += 1;
      } else {
        skippedUsers += 1;
      }
    }

    return {
      tenantId,
      totalUsers: users.length,
      syncedUsers,
      skippedUsers,
    };
  }

  static async syncAllTenantUsersToPos(): Promise<PosSyncSummary[]> {
    const tenantRows = await prisma.user.findMany({
      where: {
        username: { not: null },
        role: { not: UserRole.SUPER_ADMIN },
      },
      select: { tenantId: true },
      distinct: ['tenantId'],
      orderBy: { tenantId: 'asc' },
    });

    const summaries: PosSyncSummary[] = [];

    for (const tenant of tenantRows) {
      const summary = await UserService.syncTenantUsersToPos(tenant.tenantId);
      summaries.push(summary);
    }

    return summaries;
  }

  private static async upsertPosUser(
    client: Client,
    payload: {
      username: string;
      passwordHash: string;
      roleCandidates: string[];
      isActive: boolean;
    },
  ): Promise<void> {
    const columnRows = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_users'
      `,
    );

    const columns = new Set(columnRows.rows.map((row) => row.column_name));
    const usernameColumn = columns.has('username') ? 'username' : null;
    const passwordColumn = columns.has('password') ? 'password' : null;
    const roleColumn = columns.has('role') ? 'role' : null;
    const isActiveColumn = columns.has('is_active') ? 'is_active' : columns.has('isActive') ? 'isActive' : null;

    if (!usernameColumn || !passwordColumn) {
      throw new Error('app_users tidak memiliki kolom username/password yang dibutuhkan untuk sync');
    }

    const existing = await client.query<{ id: number | string }>(
      `SELECT id FROM app_users WHERE ${quoteIdentifier(usernameColumn)} = $1 LIMIT 1`,
      [payload.username],
    );

    const updateBaseSet = [`${quoteIdentifier(passwordColumn)} = $1`];
    const updateValues: Array<string | boolean> = [payload.passwordHash];

    if (isActiveColumn) {
      updateBaseSet.push(`${quoteIdentifier(isActiveColumn)} = $2`);
      updateValues.push(payload.isActive);
    }

    const insertColumns = [quoteIdentifier(usernameColumn), quoteIdentifier(passwordColumn)];
    const insertValues: Array<string | boolean> = [payload.username, payload.passwordHash];

    if (isActiveColumn) {
      insertColumns.push(quoteIdentifier(isActiveColumn));
      insertValues.push(payload.isActive);
    }

    const roleCandidates = roleColumn ? payload.roleCandidates : [''];

    for (const roleCandidate of roleCandidates) {
      try {
        if (existing.rowCount && existing.rowCount > 0) {
          const updateSet = [...updateBaseSet];
          const updateQueryValues = [...updateValues];

          if (roleColumn) {
            updateSet.push(`${quoteIdentifier(roleColumn)} = $${updateQueryValues.length + 1}`);
            updateQueryValues.push(roleCandidate);
          }

          updateQueryValues.push(payload.username);

          await client.query(
            `UPDATE app_users SET ${updateSet.join(', ')} WHERE ${quoteIdentifier(usernameColumn)} = $${updateQueryValues.length}`,
            updateQueryValues,
          );
        } else {
          const insertCols = [...insertColumns];
          const insertVals = [...insertValues];

          if (roleColumn) {
            insertCols.push(quoteIdentifier(roleColumn));
            insertVals.push(roleCandidate);
          }

          const placeholders = insertVals.map((_, index) => `$${index + 1}`).join(', ');

          await client.query(
            `INSERT INTO app_users (${insertCols.join(', ')}) VALUES (${placeholders})`,
            insertVals,
          );
        }

        return;
      } catch (error) {
        if (roleColumn && isRoleConstraintError(error)) {
          continue;
        }

        throw error;
      }
    }

    if (roleColumn) {
      throw new Error(
        `Tidak ada role yang kompatibel untuk app_users.role (username=${payload.username})`,
      );
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
