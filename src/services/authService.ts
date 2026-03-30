import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import { verifyPassword } from '../utils/password';
import type { LoginInput } from '../validations/authValidation';
import type { JwtAuthPayload } from '../types/auth';

type ColumnRow = {
  table_name: string;
  column_name: string;
};

type LoginTenantRecord = {
  userId: string;
  tenantId: string;
  tenantSlug: string | null;
  tenantBridgeApiUrl: string | null;
  tenantShowInventoryImages: boolean | null;
  subscriptionTier: string | null;
  syncMode: string | null;
  storedPassword: string;
  role: string | null;
  userIsActive: boolean | null;
  tenantIsActive: boolean | null;
  endDate: Date | null; // <--- DITAMBAHKAN UNTUK SUBSCRIPTION
};

type ColumnMetadata = {
  tenants: Set<string>;
  userAppAccesses: Set<string>;
  users: Set<string>;
  appInstances: Set<string>;
};

const INACTIVE_ACCOUNT_ERROR_MESSAGE =
  'Akun Anda telah dinonaktifkan. Silakan hubungi pusat layanan Goldenity.';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function pickColumn(columns: Set<string>, candidates: string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

export class AuthService {
  static async login(credentials: LoginInput) {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    const metadata = await this.getColumnMetadata();
    const resolvedLoginRecord = await this.findLoginRecord(
      credentials.username,
      metadata,
    );

    if (!resolvedLoginRecord || !(await verifyPassword(credentials.password, resolvedLoginRecord.storedPassword))) {
      throw new AppError('Username atau password tidak valid', 401);
    }

    if (resolvedLoginRecord.userIsActive === false) {
      throw new AppError(INACTIVE_ACCOUNT_ERROR_MESSAGE, 403);
    }

    if (resolvedLoginRecord.tenantIsActive === false) {
      throw new AppError('Tenant sudah tidak aktif', 403);
    }

    // PENGECEKAN SUBSCRIPTION (Masa Aktif) DITAMBAHKAN DI SINI! 🔥
    if (resolvedLoginRecord.endDate) {
      const currentDate = new Date();
      const expirationDate = new Date(resolvedLoginRecord.endDate);
      
      if (currentDate > expirationDate) {
        throw new AppError('Masa langganan aplikasi Anda telah habis. Silakan hubungi admin untuk perpanjangan.', 403);
      }
    }

    if (!resolvedLoginRecord.tenantSlug) {
      throw new AppError('Konfigurasi slug tenant tidak ditemukan untuk login', 500);
    }

    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '1d') as SignOptions['expiresIn'];
    const payload: JwtAuthPayload = {
      userId: resolvedLoginRecord.userId,
      tenantId: resolvedLoginRecord.tenantId,
      role: resolvedLoginRecord.role ?? undefined,
    };

    const token = jwt.sign(
      payload,
      jwtSecret,
      {
        expiresIn,
      }
    );

    const resolvedTier =
      (await this.resolveTierForTenant(resolvedLoginRecord.tenantId)) ??
      resolvedLoginRecord.subscriptionTier;

    return {
      token,
      tokenType: 'Bearer',
      expiresIn,
      user: {
        id: resolvedLoginRecord.userId,
        role: resolvedLoginRecord.role,
        tenantId: resolvedLoginRecord.tenantId,
      },
      tenant: {
        slug: resolvedLoginRecord.tenantSlug,
        bridge_api_url: resolvedLoginRecord.tenantBridgeApiUrl,
        showInventoryImages:
          resolvedLoginRecord.tenantShowInventoryImages !== false,
        syncMode: resolvedLoginRecord.syncMode ?? 'CLOUD_FIRST',
      },
      subscription: {
        tier: resolvedTier,
      },
    };
  }

  static async resolveTierForTenant(tenantId: string): Promise<string | null> {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ tier: string }>>(
        `
        SELECT ai."tier"::text AS tier
        FROM app_instances ai
        LEFT JOIN solutions s ON s.id = ai."solutionId"
        WHERE ai."tenantId" = $1
          AND ai.status = 'ACTIVE'
        ORDER BY
          CASE
            WHEN UPPER(COALESCE(s.code, '')) = 'POS' THEN 0
            WHEN UPPER(COALESCE(s.name, '')) LIKE '%POS%' THEN 1
            ELSE 2
          END,
          ai."updatedAt" DESC
        LIMIT 1
        `,
        tenantId,
      );
      return rows[0]?.tier ?? null;
    } catch {
      return null;
    }
  }

  private static async getColumnMetadata(): Promise<ColumnMetadata> {
    const rows = await prisma.$queryRaw<ColumnRow[]>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'user_app_accesses', 'tenants', 'app_instances')
    `;

    return rows.reduce<ColumnMetadata>(
      (metadata, row) => {
        if (row.table_name === 'users') {
          metadata.users.add(row.column_name);
        }

        if (row.table_name === 'user_app_accesses') {
          metadata.userAppAccesses.add(row.column_name);
        }

        if (row.table_name === 'tenants') {
          metadata.tenants.add(row.column_name);
        }

        if (row.table_name === 'app_instances') {
          metadata.appInstances.add(row.column_name);
        }

        return metadata;
      },
      {
        tenants: new Set<string>(),
        userAppAccesses: new Set<string>(),
        users: new Set<string>(),
        appInstances: new Set<string>(),
      }
    );
  }

  private static async findLoginRecord(
    username: string,
    metadata: ColumnMetadata
  ): Promise<LoginTenantRecord | null> {
    const usernameColumn = pickColumn(metadata.users, ['username', 'email']);
    const passwordColumn = pickColumn(metadata.users, ['password', 'password_hash', 'passwordHash']);
    const userIsActiveColumn = pickColumn(metadata.users, ['isActive', 'is_active']);
    const userRoleColumn = pickColumn(metadata.users, ['role']);
    const userIdColumn = pickColumn(metadata.users, ['id']);
    const userAppAccessUserIdColumn = pickColumn(metadata.userAppAccesses, ['userId', 'user_id']);
    const userAppAccessAppInstanceIdColumn = pickColumn(metadata.userAppAccesses, ['appInstanceId', 'app_instance_id']);
    const userAppAccessIsActiveColumn = pickColumn(metadata.userAppAccesses, ['isActive', 'is_active']);
    const userAppAccessCreatedAtColumn = pickColumn(metadata.userAppAccesses, ['createdAt', 'created_at']);
    const tenantIdColumn = pickColumn(metadata.tenants, ['id']);
    const tenantSlugColumn = pickColumn(metadata.tenants, ['slug']);
    const tenantBridgeApiUrlColumn = pickColumn(metadata.tenants, ['bridge_api_url', 'bridgeApiUrl']);
    const tenantShowInventoryImagesColumn = pickColumn(metadata.tenants, [
      'show_inventory_images',
      'showInventoryImages',
    ]);
    const tenantIsActiveColumn = pickColumn(metadata.tenants, ['isActive', 'is_active']);
    const appInstanceIdColumn = pickColumn(metadata.appInstances, ['id']);
    const appInstanceTenantIdColumn = pickColumn(metadata.appInstances, ['tenantId', 'tenant_id']);
    const appInstanceStatusColumn = pickColumn(metadata.appInstances, ['status']);
    const appInstanceTierColumn = pickColumn(metadata.appInstances, ['tier']);
    const appInstanceSyncModeColumn = pickColumn(metadata.appInstances, ['syncMode', 'sync_mode']);
    const appInstanceEndDateColumn = pickColumn(metadata.appInstances, ['endDate', 'end_date']); // <--- MENARIK KOLOM END DATE

    if (
      !usernameColumn ||
      !passwordColumn ||
      !userIdColumn ||
      !userAppAccessUserIdColumn ||
      !userAppAccessAppInstanceIdColumn ||
      !tenantIdColumn ||
      !appInstanceIdColumn ||
      !appInstanceTenantIdColumn
    ) {
      throw new AppError('Konfigurasi shared database belum lengkap untuk login', 500);
    }

    const userIsActiveSelect = userIsActiveColumn
      ? `u.${quoteIdentifier(userIsActiveColumn)} AS "userIsActive"`
      : 'NULL::boolean AS "userIsActive"';
    const userRoleSelect = userRoleColumn
      ? `u.${quoteIdentifier(userRoleColumn)} AS "role"`
      : 'NULL::text AS "role"';
    const tenantIsActiveSelect = tenantIsActiveColumn
      ? `t.${quoteIdentifier(tenantIsActiveColumn)} AS "tenantIsActive"`
      : 'NULL::boolean AS "tenantIsActive"';
    const tenantSlugSelect = tenantSlugColumn
      ? `t.${quoteIdentifier(tenantSlugColumn)} AS "tenantSlug"`
      : 'NULL::text AS "tenantSlug"';
    const tenantBridgeApiUrlSelect = tenantBridgeApiUrlColumn
      ? `t.${quoteIdentifier(tenantBridgeApiUrlColumn)} AS "tenantBridgeApiUrl"`
      : 'NULL::text AS "tenantBridgeApiUrl"';
    const tenantShowInventoryImagesSelect = tenantShowInventoryImagesColumn
      ? `t.${quoteIdentifier(tenantShowInventoryImagesColumn)} AS "tenantShowInventoryImages"`
      : 'NULL::boolean AS "tenantShowInventoryImages"';
    const userAppAccessIsActiveFilter = userAppAccessIsActiveColumn
      ? `AND uaa.${quoteIdentifier(userAppAccessIsActiveColumn)} = TRUE`
      : '';
    const appInstanceIsActiveFilter = appInstanceStatusColumn
      ? `AND ai.${quoteIdentifier(appInstanceStatusColumn)} = 'ACTIVE'`
      : '';
    const subscriptionTierSelect = appInstanceTierColumn
      ? `ai.${quoteIdentifier(appInstanceTierColumn)}::text AS "subscriptionTier"`
      : 'NULL::text AS "subscriptionTier"';
    const syncModeSelect = appInstanceSyncModeColumn
      ? `ai.${quoteIdentifier(appInstanceSyncModeColumn)}::text AS "syncMode"`
      : 'NULL::text AS "syncMode"';
    const endDateSelect = appInstanceEndDateColumn // <--- MENGIRIM END DATE KE HASIL QUERY
      ? `ai.${quoteIdentifier(appInstanceEndDateColumn)} AS "endDate"`
      : 'NULL::timestamp AS "endDate"';
    const orderBy = userAppAccessCreatedAtColumn
      ? `ORDER BY uaa.${quoteIdentifier(userAppAccessCreatedAtColumn)} DESC`
      : '';

    const query = `
      SELECT
        u.${quoteIdentifier(userIdColumn)} AS "userId",
        ai.${quoteIdentifier(appInstanceTenantIdColumn)} AS "tenantId",
        ${tenantSlugSelect},
        ${tenantBridgeApiUrlSelect},
        ${tenantShowInventoryImagesSelect},
        ${subscriptionTierSelect},
        ${syncModeSelect},
        ${endDateSelect},
        u.${quoteIdentifier(passwordColumn)} AS "storedPassword",
        ${userRoleSelect},
        ${userIsActiveSelect},
        ${tenantIsActiveSelect}
      FROM users u
      JOIN user_app_accesses uaa
        ON uaa.${quoteIdentifier(userAppAccessUserIdColumn)} = u.${quoteIdentifier(userIdColumn)}
      JOIN app_instances ai
        ON ai.${quoteIdentifier(appInstanceIdColumn)} = uaa.${quoteIdentifier(userAppAccessAppInstanceIdColumn)}
      JOIN tenants t
        ON t.${quoteIdentifier(tenantIdColumn)} = ai.${quoteIdentifier(appInstanceTenantIdColumn)}
      WHERE u.${quoteIdentifier(usernameColumn)} = $1
        ${userAppAccessIsActiveFilter}
        ${appInstanceIsActiveFilter}
      ${orderBy}
      LIMIT 1
    `;

    const rows = await prisma.$queryRawUnsafe<LoginTenantRecord[]>(query, username);
    return rows[0] ?? null;
  }
}