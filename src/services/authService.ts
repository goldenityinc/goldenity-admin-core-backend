import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { Client } from 'pg';
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
  subscriptionTier: string | null;
  targetDbUrl: string | null;
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

type TenantDbCandidate = {
  tenantId: string;
  tenantSlug: string | null;
  tenantBridgeApiUrl: string | null;
  subscriptionTier: string | null;
  targetDbUrl: string;
  tenantIsActive: boolean | null;
  endDate: Date | null; // <--- DITAMBAHKAN UNTUK SUBSCRIPTION
};

type TenantAppUserColumnRow = {
  column_name: string;
};

type TenantAppUserRow = {
  userId: string;
  storedPassword: string;
  role: string | null;
  userIsActive: boolean | null;
};

const INACTIVE_ACCOUNT_ERROR_MESSAGE =
  'Akun Anda telah dinonaktifkan. Silakan hubungi pusat layanan Goldenity.';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function pickColumn(columns: Set<string>, candidates: string[]): string | null {
  return candidates.find((candidate) => columns.has(candidate)) ?? null;
}

function normalizeUserId(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

export class AuthService {
  private static async resolvePreferredTenantIds(
    username: string,
    metadata: ColumnMetadata,
  ): Promise<Set<string>> {
    const usernameColumn = pickColumn(metadata.users, ['username', 'email']);
    const userTenantIdColumn = pickColumn(metadata.users, ['tenantId', 'tenant_id']);

    if (!usernameColumn || !userTenantIdColumn) {
      return new Set<string>();
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ tenantId: string }>>(
      `
      SELECT u.${quoteIdentifier(userTenantIdColumn)} AS "tenantId"
      FROM users u
      WHERE u.${quoteIdentifier(usernameColumn)} = $1
      `,
      username,
    );

    return new Set(rows.map((row) => row.tenantId).filter((value) => !!value));
  }

  private static async findUserInTenantAppUsers(
    tenantClient: Client,
    username: string,
  ): Promise<TenantAppUserRow | null> {
    const columnRows = await tenantClient.query<TenantAppUserColumnRow>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_users'
      `,
    );

    const appUserColumns = new Set(columnRows.rows.map((row) => row.column_name));
    const idColumn = pickColumn(appUserColumns, ['id', 'user_id', 'uid']);
    const usernameColumn = pickColumn(appUserColumns, ['username', 'email']);
    const passwordColumn = pickColumn(appUserColumns, ['password', 'password_hash', 'passwordHash']);
    const roleColumn = pickColumn(appUserColumns, ['role']);
    const userIsActiveColumn = pickColumn(appUserColumns, ['is_active', 'isActive']);

    if (!usernameColumn || !passwordColumn) {
      return null;
    }

    const userIdSelect = idColumn
      ? `${quoteIdentifier(idColumn)} AS "userId"`
      : '$2::text AS "userId"';
    const roleSelect = roleColumn
      ? `${quoteIdentifier(roleColumn)} AS "role"`
      : 'NULL::text AS "role"';
    const isActiveSelect = userIsActiveColumn
      ? `${quoteIdentifier(userIsActiveColumn)} AS "userIsActive"`
      : 'NULL::boolean AS "userIsActive"';

    const queryValues = idColumn ? [username] : [username, username];

    const tenantUserResult = await tenantClient.query<{
      userId: unknown;
      storedPassword: string;
      role: string | null;
      userIsActive: boolean | null;
    }>(
      `
      SELECT
        ${userIdSelect},
        ${quoteIdentifier(passwordColumn)} AS "storedPassword",
        ${roleSelect},
        ${isActiveSelect}
      FROM app_users
      WHERE ${quoteIdentifier(usernameColumn)} = $1
      LIMIT 1
      `,
      queryValues,
    );

    const tenantUser = tenantUserResult.rows[0];
    if (!tenantUser) {
      return null;
    }

    return {
      userId: normalizeUserId(tenantUser.userId) || username,
      storedPassword: tenantUser.storedPassword,
      role: tenantUser.role,
      userIsActive: tenantUser.userIsActive,
    };
  }

  static async login(credentials: LoginInput) {
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    const metadata = await this.getColumnMetadata();
    const loginRecord = await this.findLoginRecord(
      credentials.username,
      credentials.password,
      metadata
    );
    const passwordMatchesMaster =
      !!loginRecord &&
      (await verifyPassword(credentials.password, loginRecord.storedPassword));

    const resolvedLoginRecord = passwordMatchesMaster
      ? loginRecord
      : await this.findLoginRecordFromTenantDb(credentials.username, credentials.password, metadata);

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

    if (!resolvedLoginRecord.targetDbUrl) {
      throw new AppError('Konfigurasi DB tenant tidak ditemukan untuk login', 500);
    }

    if (!resolvedLoginRecord.tenantSlug) {
      throw new AppError('Konfigurasi slug tenant tidak ditemukan untuk login', 500);
    }

    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '1d') as SignOptions['expiresIn'];
    const payload: JwtAuthPayload = {
      userId: resolvedLoginRecord.userId,
      tenantId: resolvedLoginRecord.tenantId,
      dbUrl: resolvedLoginRecord.targetDbUrl,
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
    candidatePassword: string,
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
    const tenantIsActiveColumn = pickColumn(metadata.tenants, ['isActive', 'is_active']);
    const appInstanceIdColumn = pickColumn(metadata.appInstances, ['id']);
    const appInstanceTenantIdColumn = pickColumn(metadata.appInstances, ['tenantId', 'tenant_id']);
    const appInstanceDbUrlColumn = pickColumn(metadata.appInstances, ['dbConnectionString', 'db_connection_string']);
    const appInstanceStatusColumn = pickColumn(metadata.appInstances, ['status']);
    const appInstanceTierColumn = pickColumn(metadata.appInstances, ['tier']);
    const appInstanceEndDateColumn = pickColumn(metadata.appInstances, ['endDate', 'end_date']); // <--- MENARIK KOLOM END DATE
    const masterDbUrl = process.env.DATABASE_URL?.trim() ?? null;

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
      return this.findLoginRecordFromTenantDb(username, candidatePassword, metadata);
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
    const userAppAccessIsActiveFilter = userAppAccessIsActiveColumn
      ? `AND uaa.${quoteIdentifier(userAppAccessIsActiveColumn)} = TRUE`
      : '';
    const appInstanceIsActiveFilter = appInstanceStatusColumn
      ? `AND ai.${quoteIdentifier(appInstanceStatusColumn)} = 'ACTIVE'`
      : '';
    const targetDbUrlSelect = appInstanceDbUrlColumn
      ? `COALESCE(ai.${quoteIdentifier(appInstanceDbUrlColumn)}, $2) AS "targetDbUrl"`
      : '$2::text AS "targetDbUrl"';
    const subscriptionTierSelect = appInstanceTierColumn
      ? `ai.${quoteIdentifier(appInstanceTierColumn)}::text AS "subscriptionTier"`
      : 'NULL::text AS "subscriptionTier"';
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
        ${targetDbUrlSelect},
        ${tenantSlugSelect},
        ${tenantBridgeApiUrlSelect},
        ${subscriptionTierSelect},
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

    const rows = await prisma.$queryRawUnsafe<LoginTenantRecord[]>(query, username, masterDbUrl);

    const row = rows[0] ?? null;
    if (row && !row.targetDbUrl && masterDbUrl) {
      row.targetDbUrl = masterDbUrl;
    }

    return row;
  }

  private static async findLoginRecordFromTenantDb(
    username: string,
    candidatePassword: string,
    metadata: ColumnMetadata
  ): Promise<LoginTenantRecord | null> {
    const tenantIdColumn = pickColumn(metadata.tenants, ['id']);
    const tenantSlugColumn = pickColumn(metadata.tenants, ['slug']);
    const tenantBridgeApiUrlColumn = pickColumn(metadata.tenants, ['bridge_api_url', 'bridgeApiUrl']);
    const tenantIsActiveColumn = pickColumn(metadata.tenants, ['isActive', 'is_active']);
    const masterDbUrl = process.env.DATABASE_URL?.trim() ?? null;

    const tenantDbUrlColumn = pickColumn(metadata.tenants, ['db_connection_url', 'dbConnectionUrl']);
    const appInstanceDbUrlColumn = pickColumn(metadata.appInstances, ['dbConnectionString', 'db_connection_string']);
    const appInstanceTenantIdColumn = pickColumn(metadata.appInstances, ['tenantId', 'tenant_id']);
    const appInstanceStatusColumn = pickColumn(metadata.appInstances, ['status']);
    const appInstanceUpdatedAtColumn = pickColumn(metadata.appInstances, ['updatedAt', 'updated_at']);
    const appInstanceCreatedAtColumn = pickColumn(metadata.appInstances, ['createdAt', 'created_at']);
    const appInstanceTierColumn = pickColumn(metadata.appInstances, ['tier']);
    const appInstanceEndDateColumn = pickColumn(metadata.appInstances, ['endDate', 'end_date']); // <--- MENARIK KOLOM END DATE UNTUK FALLBACK

    if (!tenantIdColumn || (!tenantDbUrlColumn && !appInstanceDbUrlColumn)) {
      throw new AppError('Konfigurasi kolom tenant belum lengkap untuk login', 500);
    }

    const tenantIsActiveSelect = tenantIsActiveColumn
      ? `t.${quoteIdentifier(tenantIsActiveColumn)} AS "tenantIsActive"`
      : 'NULL::boolean AS "tenantIsActive"';
    const tenantSlugSelect = tenantSlugColumn
      ? `t.${quoteIdentifier(tenantSlugColumn)} AS "tenantSlug"`
      : 'NULL::text AS "tenantSlug"';
    const tenantBridgeApiUrlSelect = tenantBridgeApiUrlColumn
      ? `t.${quoteIdentifier(tenantBridgeApiUrlColumn)} AS "tenantBridgeApiUrl"`
      : 'NULL::text AS "tenantBridgeApiUrl"';
    const subscriptionTierSelect = appInstanceTierColumn
      ? `ai.${quoteIdentifier(appInstanceTierColumn)}::text AS "subscriptionTier"`
      : 'NULL::text AS "subscriptionTier"';
    const endDateSelect = appInstanceEndDateColumn // <--- SELECT END DATE UNTUK FALLBACK
      ? `ai.${quoteIdentifier(appInstanceEndDateColumn)} AS "endDate"`
      : 'NULL::timestamp AS "endDate"';

    let tenantRows: TenantDbCandidate[];

    if (tenantDbUrlColumn) {
      tenantRows = await prisma.$queryRawUnsafe<TenantDbCandidate[]>(
        `
        SELECT
          t.${quoteIdentifier(tenantIdColumn)} AS "tenantId",
          ${tenantSlugSelect},
          ${tenantBridgeApiUrlSelect},
          NULL::text AS "subscriptionTier",
          NULL::timestamp AS "endDate",
          COALESCE(t.${quoteIdentifier(tenantDbUrlColumn)}, $1) AS "targetDbUrl",
          ${tenantIsActiveSelect}
        FROM tenants t
        `,
        masterDbUrl,
      );
    } else {
      const statusOrderExpression = appInstanceStatusColumn
        ? `CASE ai.${quoteIdentifier(appInstanceStatusColumn)}
            WHEN 'ACTIVE' THEN 0
            WHEN 'SUSPENDED' THEN 1
            ELSE 2
          END`
        : '2';
      const updatedAtOrderExpression = appInstanceUpdatedAtColumn
        ? `ai.${quoteIdentifier(appInstanceUpdatedAtColumn)} DESC`
        : 'NULL';
      const createdAtOrderExpression = appInstanceCreatedAtColumn
        ? `ai.${quoteIdentifier(appInstanceCreatedAtColumn)} DESC`
        : 'NULL';

      tenantRows = await prisma.$queryRawUnsafe<TenantDbCandidate[]>(
        `
        SELECT DISTINCT ON (t.${quoteIdentifier(tenantIdColumn)})
          t.${quoteIdentifier(tenantIdColumn)} AS "tenantId",
          ${tenantSlugSelect},
          ${tenantBridgeApiUrlSelect},
          ${subscriptionTierSelect},
          ${endDateSelect},
          COALESCE(ai.${quoteIdentifier(appInstanceDbUrlColumn!)}, $1) AS "targetDbUrl",
          ${tenantIsActiveSelect}
        FROM tenants t
        LEFT JOIN app_instances ai
          ON ai.${quoteIdentifier(appInstanceTenantIdColumn!)} = t.${quoteIdentifier(tenantIdColumn)}
        ORDER BY
          t.${quoteIdentifier(tenantIdColumn)},
          ${statusOrderExpression},
          ${updatedAtOrderExpression},
          ${createdAtOrderExpression}
        `,
        masterDbUrl,
      );
    }

    const preferredTenantIds = await this.resolvePreferredTenantIds(username, metadata);
    const scopedTenantRows = preferredTenantIds.size > 0
      ? tenantRows.filter((tenant) => preferredTenantIds.has(tenant.tenantId))
      : tenantRows;

    for (const tenant of scopedTenantRows) {
      if (!tenant.targetDbUrl || tenant.tenantIsActive === false) {
        continue;
      }

      const tenantClient = new Client({
        connectionString: tenant.targetDbUrl,
        ssl: { rejectUnauthorized: false },
      });

      try {
        await tenantClient.connect();
        const tenantUser = await this.findUserInTenantAppUsers(tenantClient, username);
        if (!tenantUser) {
          continue;
        }

        if (!(await verifyPassword(candidatePassword, tenantUser.storedPassword))) {
          continue;
        }

        if (tenantUser.userIsActive === false) {
          throw new AppError(INACTIVE_ACCOUNT_ERROR_MESSAGE, 403);
        }

        return {
          userId: tenantUser.userId,
          tenantId: tenant.tenantId,
          tenantSlug: tenant.tenantSlug,
          tenantBridgeApiUrl: tenant.tenantBridgeApiUrl,
          subscriptionTier: tenant.subscriptionTier,
          targetDbUrl: tenant.targetDbUrl,
          storedPassword: tenantUser.storedPassword,
          role: tenantUser.role,
          userIsActive: tenantUser.userIsActive,
          tenantIsActive: tenant.tenantIsActive,
          endDate: tenant.endDate, // <--- RETURN END DATE
        };
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(
            `[AuthService] Tenant DB fallback skipped (tenantId=${tenant.tenantId}): ${reason}`,
          );
        }
      } finally {
        await tenantClient.end().catch(() => undefined);
      }
    }

    return null;
  }
}