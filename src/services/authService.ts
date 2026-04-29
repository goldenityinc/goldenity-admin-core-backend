import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import { verifyPassword } from '../utils/password';
import type { LoginInput } from '../validations/authValidation';
import type { JwtAuthPayload } from '../types/auth';
import { normalizeSubscriptionAddons } from '../constants/subscriptionAddons';
import { EntitlementService } from './entitlementService';

type ColumnRow = {
  table_name: string;
  column_name: string;
};

type LoginTenantRecord = {
  userId: string;
  tenantId: string;
  branchId: string | null;
  customRoleId: string | null;
  tenantSlug: string | null;
  tenantBridgeApiUrl: string | null;
  tenantShowInventoryImages: boolean | null;
  subscriptionTier: string | null;
  subscriptionAddons: string[] | null;
  syncMode: string | null;
  storedPassword: string;
  role: string | null;
  userIsActive: boolean | null;
  tenantIsActive: boolean | null;
  endDate: Date | null; // <--- DITAMBAHKAN UNTUK SUBSCRIPTION
};

type BranchLoginRecord = {
  id: string;
  name: string;
  branchCode: string | null;
  isActive: boolean;
};

type ResolvedLoginBranchContext = {
  branch: BranchLoginRecord | null;
  isHQ: boolean;
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

function isLoginTraceEnabled(): boolean {
  const raw = (process.env.LOGIN_TRACE ?? process.env.LOGIN_DIAGNOSTIC_MODE ?? 'true')
    .toString()
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

function logLoginTrace(stage: string, payload?: Record<string, unknown>): void {
  if (!isLoginTraceEnabled()) {
    return;
  }
  if (payload) {
    console.log(`[AuthService.login] ${stage}`, payload);
    return;
  }
  console.log(`[AuthService.login] ${stage}`);
}

function normalizeRole(role: string | null | undefined): string {
  return (role ?? '').trim().toUpperCase();
}

export class AuthService {
  static async login(credentials: LoginInput) {
    const jwtSecret = process.env.JWT_SECRET;

    logLoginTrace('start', {
      username: credentials.username,
      tenantSlug: credentials.tenantSlug,
    });

    if (!jwtSecret) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    const metadata = await this.getColumnMetadata();
    logLoginTrace('metadata-loaded', {
      usersColumns: metadata.users.size,
      tenantsColumns: metadata.tenants.size,
      userAppAccessesColumns: metadata.userAppAccesses.size,
      appInstancesColumns: metadata.appInstances.size,
    });

    // Step 1: Validasi Kode Perusahaan — pastikan slug tenant benar-benar ada di database.
    // Ini adalah kunci keamanan multi-tenant: login HARUS gagal jika company code salah.
    const resolvedTenantId = await this.resolveTenantIdBySlug(credentials.tenantSlug, metadata);
    if (!resolvedTenantId) {
      logLoginTrace('tenant-not-found', {
        tenantSlug: credentials.tenantSlug,
      });
      throw new AppError('Kode Perusahaan tidak ditemukan', 401);
    }
    logLoginTrace('tenant-found', {
      tenantSlug: credentials.tenantSlug,
      tenantId: resolvedTenantId,
    });

    // Step 2: Cari user yang terdaftar di tenant tersebut (chain query — tenant-scoped lookup).
    // tenantId di-pass eksplisit sehingga user dari tenant lain tidak bisa ikut ditemukan.
    let resolvedLoginRecord = await this.findLoginRecord(
      credentials.username,
      resolvedTenantId,
      metadata,
    );

    if (!resolvedLoginRecord) {
      logLoginTrace('join-lookup-miss-fallback-to-user-tenant-lookup', {
        username: credentials.username,
        tenantId: resolvedTenantId,
      });
      // Fallback for newly-provisioned users that may not yet have
      // user_app_accesses/app_instances linkage rows.
      resolvedLoginRecord = await this.findTenantUserRecordWithoutAccessJoin(
        credentials.username,
        resolvedTenantId,
        metadata,
      );
    }

    if (!resolvedLoginRecord) {
      logLoginTrace('user-not-found-in-tenant', {
        username: credentials.username,
        tenantId: resolvedTenantId,
      });
      throw new AppError('Username tidak terdaftar di perusahaan ini', 401);
    }
    logLoginTrace('user-found', {
      userId: resolvedLoginRecord.userId,
      tenantId: resolvedLoginRecord.tenantId,
      role: resolvedLoginRecord.role,
    });

    // Primary check: bcrypt hash compare (current standard).
    // Fallback: strict plain-text compare for legacy rows that may still store
    // non-hashed passwords in old schemas.
    const bcryptMatch = await verifyPassword(
      credentials.password,
      resolvedLoginRecord.storedPassword,
    );
    const plainTextMatch = credentials.password === resolvedLoginRecord.storedPassword;
    const passwordMatches = bcryptMatch || plainTextMatch;
    logLoginTrace('password-verified', {
      storedPasswordFormat: resolvedLoginRecord.storedPassword?.startsWith('$2')
        ? 'bcrypt'
        : 'legacy-or-plain',
      bcryptMatch,
      plainTextMatch,
      passwordMatches,
    });

    if (!passwordMatches) {
      throw new AppError('Username atau password tidak valid', 401);
    }

    logLoginTrace('active-status', {
      userIsActive: resolvedLoginRecord.userIsActive,
      tenantIsActive: resolvedLoginRecord.tenantIsActive,
      role: resolvedLoginRecord.role,
    });

    if (resolvedLoginRecord.userIsActive === false) {
      throw new AppError(INACTIVE_ACCOUNT_ERROR_MESSAGE, 403);
    }

    if (resolvedLoginRecord.tenantIsActive === false) {
      throw new AppError('Tenant sudah tidak aktif', 403);
    }

    const resolvedBranchContext = await this.resolveBranchForLogin(
      resolvedLoginRecord,
    );
    const resolvedBranch = resolvedBranchContext.branch;

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
    const resolvedEntitlements = await EntitlementService.resolveForTenant(
      resolvedLoginRecord.tenantId,
    );
    const tier =
      resolvedEntitlements.subscription.tier ??
      resolvedLoginRecord.subscriptionTier ??
      null;
    const addons = normalizeSubscriptionAddons(
      resolvedEntitlements.subscription.addons ??
        resolvedLoginRecord.subscriptionAddons ??
        [],
    );
    const tenant = await prisma.tenant.findUnique({
      where: { id: resolvedLoginRecord.tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        bridgeApiUrl: true,
        showInventoryImages: true,
      },
    });
    const payload: JwtAuthPayload = {
      userId: resolvedLoginRecord.userId,
      tenantId: resolvedLoginRecord.tenantId,
      role: resolvedLoginRecord.role ?? undefined,
      branchId: resolvedBranch?.id ?? undefined,
      branchCode: resolvedBranch?.branchCode ?? undefined,
      isHQ: resolvedBranchContext.isHQ || undefined,
      tier,
      addons,
      entitlementsRevision: resolvedEntitlements.entitlements.revision,
      activeModules: resolvedEntitlements.entitlements.active_modules,
    };

    const token = jwt.sign(
      payload,
      jwtSecret,
      {
        expiresIn,
      }
    );

    logLoginTrace('success', {
      userId: resolvedLoginRecord.userId,
      tenantId: resolvedLoginRecord.tenantId,
      role: resolvedLoginRecord.role,
      branchId: resolvedBranch?.id ?? null,
      isHQ: resolvedBranchContext.isHQ,
      tier,
    });

    return {
      token,
      tokenType: 'Bearer',
      expiresIn,
      user: {
        id: resolvedLoginRecord.userId,
        username: credentials.username,
        role: resolvedLoginRecord.role ?? 'CRM_STAFF',
        tenantId: resolvedLoginRecord.tenantId,
        branchId: resolvedBranch?.id ?? null,
        isHQ: resolvedBranchContext.isHQ,
        customRoleId: resolvedLoginRecord.customRoleId,
      },
      branch: resolvedBranch
        ? {
            id: resolvedBranch.id,
            name: resolvedBranch.name,
            branchCode: resolvedBranch.branchCode,
          }
        : null,
      tenant: {
        id: resolvedLoginRecord.tenantId,
        slug: tenant?.slug ?? resolvedLoginRecord.tenantSlug,
        name: tenant?.name ?? resolvedLoginRecord.tenantSlug ?? resolvedLoginRecord.tenantId,
        bridgeApiUrl:
          tenant?.bridgeApiUrl ?? resolvedLoginRecord.tenantBridgeApiUrl,
        showInventoryImages:
          (tenant?.showInventoryImages ??
            resolvedLoginRecord.tenantShowInventoryImages) !== false,
        syncMode: resolvedLoginRecord.syncMode ?? 'CLOUD_FIRST',
      },
      entitlements: resolvedEntitlements.entitlements,
      subscription: {
        tier,
        addons,
        endDate:
          resolvedEntitlements.subscription.endDate ??
          resolvedLoginRecord.endDate?.toISOString() ??
          null,
      },
    };
  }

  static async resolveTierForTenant(tenantId: string): Promise<string | null> {
    const subscription = await this.resolveSubscriptionForTenant(tenantId);
    return subscription?.tier ?? null;
  }

  static async resolveSubscriptionForTenant(tenantId: string): Promise<{ tier: string | null; addons: string[] } | null> {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ tier: string | null; addons: string[] | null }>>(
        `
        SELECT
          ai."tier"::text AS tier,
          COALESCE(ai."addons", ARRAY[]::text[]) AS addons
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
      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        tier: row.tier ?? null,
        addons: normalizeSubscriptionAddons(row.addons),
      };
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

  // Resolves a tenant's primary key from its slug.
  // Returns null (not throws) when the slug simply doesn't match any row,
  // so the caller can return a clean 401 instead of a 500.
  private static async resolveTenantIdBySlug(
    slug: string,
    metadata: ColumnMetadata,
  ): Promise<string | null> {
    const tenantIdColumn = pickColumn(metadata.tenants, ['id']);
    const tenantSlugColumn = pickColumn(metadata.tenants, ['slug']);
    if (!tenantIdColumn || !tenantSlugColumn) {
      throw new AppError(
        'Konfigurasi kolom tenant (id/slug) tidak ditemukan di database',
        500,
      );
    }
    // Use LOWER() on both sides so a user typing "TTP" still matches slug "ttp".
    // The Zod transform already lowercases the input, but this protects against
    // any future callers that bypass the schema.
    const rows = await prisma.$queryRawUnsafe<Array<{ tenantId: string }>>(
      `SELECT ${quoteIdentifier(tenantIdColumn)} AS "tenantId" FROM tenants WHERE LOWER(${quoteIdentifier(tenantSlugColumn)}) = LOWER($1) LIMIT 1`,
      slug,
    );
    return rows[0]?.tenantId ?? null;
  }

  private static async findLoginRecord(
    username: string,
    tenantId: string,
    metadata: ColumnMetadata,
  ): Promise<LoginTenantRecord | null> {
    const usernameColumn = pickColumn(metadata.users, ['username', 'email']);
    // Prefer hashed password columns first. Some shared DBs still keep a legacy
    // `password` column (nullable/plain), and selecting it first can cause
    // false 401 for newly-created users saved in `password_hash`/`passwordHash`.
    const passwordColumn = pickColumn(metadata.users, ['password_hash', 'passwordHash', 'password']);
    const userIsActiveColumn = pickColumn(metadata.users, ['isActive', 'is_active']);
    const userRoleColumn = pickColumn(metadata.users, ['role']);
    const userCustomRoleIdColumn = pickColumn(metadata.users, [
      'customRoleId',
      'custom_role_id',
    ]);
    const userBranchIdColumn = pickColumn(metadata.users, ['branch_id', 'branchId']);
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
    const appInstanceAddonsColumn = pickColumn(metadata.appInstances, ['addons']);
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
    const userCustomRoleIdSelect = userCustomRoleIdColumn
      ? `u.${quoteIdentifier(userCustomRoleIdColumn)} AS "customRoleId"`
      : 'NULL::text AS "customRoleId"';
    const userBranchIdSelect = userBranchIdColumn
      ? `u.${quoteIdentifier(userBranchIdColumn)}::text AS "branchId"`
      : 'NULL::text AS "branchId"';
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
    const subscriptionAddonsSelect = appInstanceAddonsColumn
      ? `COALESCE(ai.${quoteIdentifier(appInstanceAddonsColumn)}, ARRAY[]::text[]) AS "subscriptionAddons"`
      : 'NULL::text[] AS "subscriptionAddons"';
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
        ${userBranchIdSelect},
        ${userCustomRoleIdSelect},
        ${tenantSlugSelect},
        ${tenantBridgeApiUrlSelect},
        ${tenantShowInventoryImagesSelect},
        ${subscriptionTierSelect},
        ${subscriptionAddonsSelect},
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
        AND ai.${quoteIdentifier(appInstanceTenantIdColumn)} = $2
        ${userAppAccessIsActiveFilter}
        ${appInstanceIsActiveFilter}
      ${orderBy}
      LIMIT 1
    `;

    const rows = await prisma.$queryRawUnsafe<LoginTenantRecord[]>(query, username, tenantId);
    return rows[0] ?? null;
  }

  // Fallback lookup that enforces username + tenant ownership directly on `users`
  // and does not require user_app_accesses/app_instances links to exist yet.
  private static async findTenantUserRecordWithoutAccessJoin(
    username: string,
    tenantId: string,
    metadata: ColumnMetadata,
  ): Promise<LoginTenantRecord | null> {
    const usernameColumn = pickColumn(metadata.users, ['username', 'email']);
    const passwordColumn = pickColumn(metadata.users, ['password_hash', 'passwordHash', 'password']);
    const userIsActiveColumn = pickColumn(metadata.users, ['isActive', 'is_active']);
    const userRoleColumn = pickColumn(metadata.users, ['role']);
    const userCustomRoleIdColumn = pickColumn(metadata.users, [
      'customRoleId',
      'custom_role_id',
    ]);
    const userBranchIdColumn = pickColumn(metadata.users, ['branch_id', 'branchId']);
    const userIdColumn = pickColumn(metadata.users, ['id']);
    const userTenantIdColumn = pickColumn(metadata.users, ['tenantId', 'tenant_id']);
    const tenantIdColumn = pickColumn(metadata.tenants, ['id']);
    const tenantSlugColumn = pickColumn(metadata.tenants, ['slug']);
    const tenantBridgeApiUrlColumn = pickColumn(metadata.tenants, ['bridge_api_url', 'bridgeApiUrl']);
    const tenantShowInventoryImagesColumn = pickColumn(metadata.tenants, [
      'show_inventory_images',
      'showInventoryImages',
    ]);
    const tenantIsActiveColumn = pickColumn(metadata.tenants, ['isActive', 'is_active']);

    if (
      !usernameColumn ||
      !passwordColumn ||
      !userIdColumn ||
      !userTenantIdColumn ||
      !tenantIdColumn
    ) {
      return null;
    }

    const userIsActiveSelect = userIsActiveColumn
      ? `u.${quoteIdentifier(userIsActiveColumn)} AS "userIsActive"`
      : 'NULL::boolean AS "userIsActive"';
    const userRoleSelect = userRoleColumn
      ? `u.${quoteIdentifier(userRoleColumn)} AS "role"`
      : 'NULL::text AS "role"';
    const userCustomRoleIdSelect = userCustomRoleIdColumn
      ? `u.${quoteIdentifier(userCustomRoleIdColumn)} AS "customRoleId"`
      : 'NULL::text AS "customRoleId"';
    const userBranchIdSelect = userBranchIdColumn
      ? `u.${quoteIdentifier(userBranchIdColumn)}::text AS "branchId"`
      : 'NULL::text AS "branchId"';
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

    const query = `
      SELECT
        u.${quoteIdentifier(userIdColumn)} AS "userId",
        u.${quoteIdentifier(userTenantIdColumn)} AS "tenantId",
        ${userBranchIdSelect},
        ${userCustomRoleIdSelect},
        ${tenantSlugSelect},
        ${tenantBridgeApiUrlSelect},
        ${tenantShowInventoryImagesSelect},
        NULL::text AS "subscriptionTier",
        NULL::text[] AS "subscriptionAddons",
        NULL::text AS "syncMode",
        NULL::timestamp AS "endDate",
        u.${quoteIdentifier(passwordColumn)} AS "storedPassword",
        ${userRoleSelect},
        ${userIsActiveSelect},
        ${tenantIsActiveSelect}
      FROM users u
      JOIN tenants t
        ON t.${quoteIdentifier(tenantIdColumn)} = u.${quoteIdentifier(userTenantIdColumn)}
      WHERE u.${quoteIdentifier(usernameColumn)} = $1
        AND u.${quoteIdentifier(userTenantIdColumn)} = $2
      LIMIT 1
    `;

    const rows = await prisma.$queryRawUnsafe<LoginTenantRecord[]>(query, username, tenantId);
    return rows[0] ?? null;
  }

  private static async findBranchById(
    tenantId: string,
    branchId: string,
  ): Promise<BranchLoginRecord | null> {
    const rows = await prisma.$queryRawUnsafe<BranchLoginRecord[]>(
      `
      SELECT
        "id"::text AS "id",
        "name",
        "branch_code" AS "branchCode",
        COALESCE("is_active", TRUE) AS "isActive"
      FROM "branches"
      WHERE "tenant_id" = $1
        AND "id"::text = $2
      LIMIT 1
      `,
      tenantId,
      branchId,
    );

    return rows[0] ?? null;
  }

  private static async resolveBranchForLogin(
    loginRecord: LoginTenantRecord,
  ): Promise<ResolvedLoginBranchContext> {
    const normalizedBranchId = loginRecord.branchId?.trim();
    const normalizedRole = normalizeRole(loginRecord.role);
    const isTenantAdmin = normalizedRole === 'TENANT_ADMIN';
    const requiresAssignedBranch = normalizedRole === 'CRM_STAFF' || normalizedRole === 'CASHIER';

    if (normalizedBranchId) {
      const branch = await this.findBranchById(loginRecord.tenantId, normalizedBranchId);
      if (!branch) {
        throw new AppError('Cabang user tidak ditemukan pada tenant ini', 403);
      }

      if (!branch.isActive) {
        throw new AppError('Cabang user sudah tidak aktif', 403);
      }

      return {
        branch,
        isHQ: false,
      };
    }

    if (isTenantAdmin) {
      return {
        branch: null,
        isHQ: true,
      };
    }

    if (requiresAssignedBranch) {
      throw new AppError('Akun belum ditugaskan ke cabang mana pun.', 403);
    }

    return {
      branch: null,
      isHQ: false,
    };
  }
}