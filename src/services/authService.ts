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
  targetDbUrl: string;
  storedPassword: string;
  userIsActive: boolean | null;
  tenantIsActive: boolean | null;
};

type ColumnMetadata = {
  tenants: Set<string>;
  userAppAccesses: Set<string>;
  users: Set<string>;
  appInstances: Set<string>;
};

type TenantDbCandidate = {
  tenantId: string;
  targetDbUrl: string;
  tenantIsActive: boolean | null;
};

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
    const loginRecord = await this.findLoginRecord(
      credentials.username,
      credentials.password,
      metadata
    );

    if (!loginRecord || !(await verifyPassword(credentials.password, loginRecord.storedPassword))) {
      throw new AppError('Username atau password tidak valid', 401);
    }

    if (loginRecord.userIsActive === false) {
      throw new AppError('Akun user sudah tidak aktif', 403);
    }

    if (loginRecord.tenantIsActive === false) {
      throw new AppError('Tenant sudah tidak aktif', 403);
    }

    const expiresIn = (process.env.JWT_EXPIRES_IN ?? '1d') as SignOptions['expiresIn'];
    const payload: JwtAuthPayload = {
      userId: loginRecord.userId,
      tenantId: loginRecord.tenantId,
      dbUrl: loginRecord.targetDbUrl,
    };

    const token = jwt.sign(
      payload,
      jwtSecret,
      {
        expiresIn,
      }
    );

    return {
      token,
      tokenType: 'Bearer',
      expiresIn,
    };
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
    const userIdColumn = pickColumn(metadata.users, ['id']);
    const userAppAccessUserIdColumn = pickColumn(metadata.userAppAccesses, ['userId', 'user_id']);
    const userAppAccessTenantIdColumn = pickColumn(metadata.userAppAccesses, ['tenantId', 'tenant_id']);
    const userAppAccessIsActiveColumn = pickColumn(metadata.userAppAccesses, ['isActive', 'is_active']);
    const userAppAccessCreatedAtColumn = pickColumn(metadata.userAppAccesses, ['createdAt', 'created_at']);
    const tenantIdColumn = pickColumn(metadata.tenants, ['id']);
    const tenantDbUrlColumn = pickColumn(metadata.tenants, ['db_connection_url', 'dbConnectionUrl']);
    const tenantIsActiveColumn = pickColumn(metadata.tenants, ['isActive', 'is_active']);

    if (
      !usernameColumn ||
      !passwordColumn ||
      !userIdColumn ||
      !userAppAccessUserIdColumn ||
      !userAppAccessTenantIdColumn ||
      !tenantIdColumn ||
      !tenantDbUrlColumn
    ) {
      return this.findLoginRecordFromTenantDb(username, candidatePassword, metadata);
    }

    const userIsActiveSelect = userIsActiveColumn
      ? `u.${quoteIdentifier(userIsActiveColumn)} AS "userIsActive"`
      : 'NULL::boolean AS "userIsActive"';
    const tenantIsActiveSelect = tenantIsActiveColumn
      ? `t.${quoteIdentifier(tenantIsActiveColumn)} AS "tenantIsActive"`
      : 'NULL::boolean AS "tenantIsActive"';
    const userAppAccessIsActiveFilter = userAppAccessIsActiveColumn
      ? `AND uaa.${quoteIdentifier(userAppAccessIsActiveColumn)} = TRUE`
      : '';
    const orderBy = userAppAccessCreatedAtColumn
      ? `ORDER BY uaa.${quoteIdentifier(userAppAccessCreatedAtColumn)} DESC`
      : '';

    const query = `
      SELECT
        u.${quoteIdentifier(userIdColumn)} AS "userId",
        uaa.${quoteIdentifier(userAppAccessTenantIdColumn)} AS "tenantId",
        t.${quoteIdentifier(tenantDbUrlColumn)} AS "targetDbUrl",
        u.${quoteIdentifier(passwordColumn)} AS "storedPassword",
        ${userIsActiveSelect},
        ${tenantIsActiveSelect}
      FROM users u
      JOIN user_app_accesses uaa
        ON uaa.${quoteIdentifier(userAppAccessUserIdColumn)} = u.${quoteIdentifier(userIdColumn)}
      JOIN tenants t
        ON t.${quoteIdentifier(tenantIdColumn)} = uaa.${quoteIdentifier(userAppAccessTenantIdColumn)}
      WHERE u.${quoteIdentifier(usernameColumn)} = $1
        ${userAppAccessIsActiveFilter}
      ${orderBy}
      LIMIT 1
    `;

    const rows = await prisma.$queryRawUnsafe<LoginTenantRecord[]>(query, username);

    return rows[0] ?? null;
  }

  private static async findLoginRecordFromTenantDb(
    username: string,
    candidatePassword: string,
    metadata: ColumnMetadata
  ): Promise<LoginTenantRecord | null> {
    const tenantIdColumn = pickColumn(metadata.tenants, ['id']);
    const tenantIsActiveColumn = pickColumn(metadata.tenants, ['isActive', 'is_active']);

    // Prefer db URL stored directly on tenants; fall back to app_instances (current schema)
    const tenantDbUrlColumn = pickColumn(metadata.tenants, ['db_connection_url', 'dbConnectionUrl']);
    const appInstanceDbUrlColumn = pickColumn(metadata.appInstances, ['dbConnectionString', 'db_connection_string']);
    const appInstanceTenantIdColumn = pickColumn(metadata.appInstances, ['tenantId', 'tenant_id']);
    const appInstanceStatusColumn = pickColumn(metadata.appInstances, ['status']);

    if (!tenantIdColumn || (!tenantDbUrlColumn && !appInstanceDbUrlColumn)) {
      throw new AppError('Konfigurasi kolom tenant belum lengkap untuk login', 500);
    }

    const tenantIsActiveSelect = tenantIsActiveColumn
      ? `t.${quoteIdentifier(tenantIsActiveColumn)} AS "tenantIsActive"`
      : 'NULL::boolean AS "tenantIsActive"';

    let tenantRows: TenantDbCandidate[];

    if (tenantDbUrlColumn) {
      // Legacy path: DB URL is a column on the tenants table
      tenantRows = await prisma.$queryRawUnsafe<TenantDbCandidate[]>(
        `
        SELECT
          t.${quoteIdentifier(tenantIdColumn)} AS "tenantId",
          t.${quoteIdentifier(tenantDbUrlColumn)} AS "targetDbUrl",
          ${tenantIsActiveSelect}
        FROM tenants t
        WHERE t.${quoteIdentifier(tenantDbUrlColumn)} IS NOT NULL
        `
      );
    } else {
      // Current schema path: DB URL lives in app_instances.dbConnectionString
      const statusFilter = appInstanceStatusColumn
        ? `AND ai.${quoteIdentifier(appInstanceStatusColumn)} = 'ACTIVE'`
        : '';
      tenantRows = await prisma.$queryRawUnsafe<TenantDbCandidate[]>(
        `
        SELECT
          t.${quoteIdentifier(tenantIdColumn)} AS "tenantId",
          ai.${quoteIdentifier(appInstanceDbUrlColumn!)} AS "targetDbUrl",
          ${tenantIsActiveSelect}
        FROM tenants t
        JOIN app_instances ai
          ON ai.${quoteIdentifier(appInstanceTenantIdColumn!)} = t.${quoteIdentifier(tenantIdColumn)}
        WHERE ai.${quoteIdentifier(appInstanceDbUrlColumn!)} IS NOT NULL
          ${statusFilter}
        `
      );
    }

    for (const tenant of tenantRows) {
      if (!tenant.targetDbUrl || tenant.tenantIsActive === false) {
        continue;
      }

      const tenantClient = new Client({
        connectionString: tenant.targetDbUrl,
        ssl: { rejectUnauthorized: false },
      });

      try {
        await tenantClient.connect();
        const userRows = await tenantClient.query<{
          id: string;
          password: string;
        }>(
          'SELECT id, password FROM app_users WHERE username = $1 LIMIT 1',
          [username]
        );

        const tenantUser = userRows.rows[0];
        if (!tenantUser) {
          continue;
        }

        if (!(await verifyPassword(candidatePassword, tenantUser.password))) {
          continue;
        }

        return {
          userId: tenantUser.id,
          tenantId: tenant.tenantId,
          targetDbUrl: tenant.targetDbUrl,
          storedPassword: tenantUser.password,
          userIsActive: true,
          tenantIsActive: tenant.tenantIsActive,
        };
      } catch {
        // Ignore inaccessible tenant DB and continue to next candidate.
      } finally {
        await tenantClient.end().catch(() => undefined);
      }
    }

    return null;
  }
}