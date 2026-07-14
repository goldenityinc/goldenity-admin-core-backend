import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { AuditLogService } from '../services/auditLogService';
import { AuthService } from '../services/authService';
import { EntitlementService } from '../services/entitlementService';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { hashPassword, verifyPassword } from '../utils/password';
import { loginSchema } from '../validations/authValidation';

async function createAuditLogSafely(input: {
  tenantId: string;
  userId?: string | null;
  userName?: string | null;
  actionType: string;
  details: string;
}): Promise<void> {
  const tenantId = (input.tenantId ?? '').toString().trim();
  if (!tenantId) {
    return;
  }

  try {
    await prisma.audit_logs.create({
      data: {
        tenant_id: tenantId,
        user_id: (input.userId ?? '').toString().trim() || null,
        user_name: (input.userName ?? '').toString().trim() || null,
        action_type: input.actionType,
        details: input.details,
      },
    });
  } catch (error: any) {
    if (error?.code === 'P2021') {
      return;
    }
    throw error;
  }
}

function normalizeSettingKey(input: string | null | undefined): string {
  return (input ?? '').toString().trim().toLowerCase();
}

function parseBooleanSetting(input: string | null | undefined): boolean | null {
  const normalized = (input ?? '').toString().trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['1', 'true', 'yes', 'on', 'aktif'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'nonaktif'].includes(normalized)) {
    return false;
  }

  return null;
}

function parseNumberSetting(input: string | null | undefined): number | null {
  const raw = (input ?? '').toString().trim();
  if (!raw) {
    return null;
  }

  const value = Number(raw.replace(',', '.'));
  if (Number.isNaN(value)) {
    return null;
  }

  return value;
}

function parseActiveModules(input: string | null | undefined): string[] {
  const raw = (input ?? '').toString().trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0);
      }
    } catch {
      // Fall through to comma-separated parsing.
    }
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  console.log('[authController.login] request-received', {
    bodyKeys: Object.keys(req.body ?? {}),
    username: req.body?.username,
    tenantSlug:
      req.body?.tenantSlug ??
      req.body?.tenant_slug ??
      req.body?.kode_perusahaan,
  });

  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    console.log('[authController.login] validation-failed', {
      issues: parsed.error.issues,
    });
    throw new AppError(parsed.error.issues[0]?.message ?? 'Payload login tidak valid', 400);
  }

  const result = await AuthService.login(parsed.data);

  await createAuditLogSafely({
    tenantId: (result.user?.tenantId ?? '').toString(),
    userId: (result.user?.id ?? '').toString(),
    userName: (result.user?.username ?? '').toString(),
    actionType: 'USER_LOGIN',
    details: 'User berhasil login ke sistem',
  });

  return res.status(200).json({
    success: true,
    token: result.token,
    tokenType: result.tokenType,
    expiresIn: result.expiresIn,
    user: result.user,
    tenant: result.tenant,
    entitlements: result.entitlements,
    subscription: result.subscription,
  });
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
  const email = (req.body?.email ?? '').toString().trim().toLowerCase();
  const password = (req.body?.password ?? '').toString();

  if (!email || !password) {
    throw new AppError('email dan password wajib diisi', 400);
  }

  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      tenantId: true,
      passwordHash: true,
      tenant: {
        select: {
          id: true,
          name: true,
          isActive: true,
        },
      },
    },
  });

  if (!user || !user.passwordHash) {
    throw new AppError('Username atau password tidak valid', 401);
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError('Username atau password tidak valid', 401);
  }

  if (!user.tenant?.isActive) {
    throw new AppError('Tenant tidak aktif', 403);
  }

  const subscriptions = await prisma.$queryRaw<Array<{ activeModules: string | null }>>`
    SELECT "activeModules"
    FROM "subscriptions"
    WHERE "tenantId" = ${user.tenantId}
      AND UPPER("solution") = 'SCHOOL_ERP'
      AND UPPER("status") = 'ACTIVE'
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;

  const subscription = subscriptions[0];
  if (!subscription) {
    throw new AppError('Unauthorized for this product', 403);
  }

  const activeModules = parseActiveModules(subscription.activeModules);

  return res.status(200).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    tenant: {
      status: 'ACTIVE',
      activeModules,
    },
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const tenantId = (req.user.tenantId ?? '').toString();
  const userId = (req.user.userId ?? '').toString();
  if (!tenantId) {
    throw new AppError('Tenant ID tidak ditemukan di token', 400);
  }

  const [tenant, user, settingsRows, resolved] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        address: true,
        phone: true,
        logoUrl: true,
        showInventoryImages: true,
        businessCategory: true,
        updatedAt: true,
      },
    }),
    userId
      ? prisma.user.findFirst({
          where: {
            id: userId,
            tenantId,
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            allowedSolutions: true,
            branchId: true,
            isActive: true,
            updatedAt: true,
          },
        })
      : Promise.resolve(null),
    prisma.store_settings.findMany({
      where: {
        tenant_id: tenantId,
        OR: [
          {
            key: {
              in: [
                'store_name',
                'nama_toko',
                'name',
                'store_address',
                'alamat',
                'address',
                'tax_enabled',
                'enable_tax',
                'include_tax',
                'prices_include_tax',
                'tax_rate',
                'ppn_rate',
                'vat_rate',
                'tax_name',
                'tax_label',
                'npwp',
                'tax_id',
              ],
            },
          },
          { key: { contains: 'tax', mode: 'insensitive' } },
          { key: { contains: 'ppn', mode: 'insensitive' } },
          { key: { contains: 'vat', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
      select: {
        key: true,
        value: true,
      },
    }),
    EntitlementService.resolveForTenant(tenantId),
  ]);

  if (!tenant) {
    throw new AppError('Tenant tidak ditemukan', 404);
  }

  const settingsMap = new Map<string, string>();
  for (const row of settingsRows) {
    const key = normalizeSettingKey(row.key);
    if (!key || settingsMap.has(key)) {
      continue;
    }
    settingsMap.set(key, (row.value ?? '').toString().trim());
  }

  const storeName =
    settingsMap.get('store_name') ||
    settingsMap.get('nama_toko') ||
    settingsMap.get('name') ||
    tenant.name;

  const storeAddress =
    settingsMap.get('store_address') ||
    settingsMap.get('alamat') ||
    settingsMap.get('address') ||
    tenant.address ||
    null;

  const taxSettings = {
    enabled:
      parseBooleanSetting(settingsMap.get('tax_enabled')) ??
      parseBooleanSetting(settingsMap.get('enable_tax')),
    includeTaxInPrice:
      parseBooleanSetting(settingsMap.get('prices_include_tax')) ??
      parseBooleanSetting(settingsMap.get('include_tax')),
    rate:
      parseNumberSetting(settingsMap.get('tax_rate')) ??
      parseNumberSetting(settingsMap.get('ppn_rate')) ??
      parseNumberSetting(settingsMap.get('vat_rate')),
    name:
      settingsMap.get('tax_name') ||
      settingsMap.get('tax_label') ||
      null,
    taxId:
      settingsMap.get('npwp') ||
      settingsMap.get('tax_id') ||
      null,
    raw: Object.fromEntries(settingsMap.entries()),
  };

  return res.status(200).json({
    success: true,
    data: {
      user: {
        id: user?.id ?? req.user.userId ?? null,
        name: user?.name ?? null,
        email: user?.email ?? req.user.email ?? null,
        role: user?.role ?? req.user.role ?? null,
        allowedSolutions: user?.allowedSolutions ?? req.user.allowedSolutions ?? [],
        branchId: user?.branchId?.toString() ?? req.user.branchId ?? null,
        tenantId,
      },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        address: tenant.address,
        phone: tenant.phone,
        logoUrl: tenant.logoUrl,
        showInventoryImages: tenant.showInventoryImages,
        business_category: tenant.businessCategory,
      },
      profile: {
        store_name: storeName,
        address: storeAddress,
        tax_settings: taxSettings,
      },
      active_modules: resolved.entitlements.active_modules,
      feature_flags: resolved.entitlements.modules,
      business_category: tenant.businessCategory,
      subscription: resolved.subscription,
      subscriptionEndDate: resolved.subscription.endDate,
      entitlements_revision: resolved.entitlements.revision,
      resolved_at: resolved.entitlements.resolvedAt,
      last_updated_at: new Date(
        Math.max(
          tenant.updatedAt.getTime(),
          user?.updatedAt?.getTime() ?? 0,
        ),
      ).toISOString(),
    },
  });
});

export const getSubscription = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const tenantId = (req.user as { tenantId?: string }).tenantId ?? '';
  if (!tenantId) {
    throw new AppError('Tenant ID tidak ditemukan di token', 400);
  }

  const subscription = await AuthService.resolveSubscriptionForTenant(tenantId);
  const tier = subscription?.tier ?? null;
  const addons = subscription?.addons ?? [];
  const endDate = subscription?.endDate ?? null;

  return res.status(200).json({
    success: true,
    user: {
      tier,
      addons,
      endDate,
      subscriptionEndDate: endDate,
    },
    subscription: {
      tier,
      addons,
      endDate,
      subscriptionEndDate: endDate,
    },
  });
});

export const getEntitlements = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const tenantId = (req.user as { tenantId?: string }).tenantId ?? '';
  if (!tenantId) {
    throw new AppError('Tenant ID tidak ditemukan di token', 400);
  }

  const resolved = await EntitlementService.resolveForTenant(tenantId);

  return res.status(200).json({
    success: true,
    data: {
      ...resolved.entitlements,
      subscription: resolved.subscription,
    },
  });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.userId || !req.user?.tenantId) {
    throw new AppError('User not authenticated', 401);
  }

  const oldPassword = (req.body?.oldPassword ?? req.body?.currentPassword ?? '')
    .toString()
    .trim();
  const newPassword = (req.body?.newPassword ?? req.body?.password ?? '')
    .toString()
    .trim();

  if (!oldPassword || !newPassword) {
    throw new AppError('oldPassword dan newPassword wajib diisi', 400);
  }

  if (newPassword.length < 6) {
    throw new AppError('Password baru minimal 6 karakter', 400);
  }

  const user = await prisma.user.findFirst({
    where: {
      id: req.user.userId,
      tenantId: req.user.tenantId,
    },
    select: {
      id: true,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new AppError('User tidak ditemukan', 404);
  }

  const storedPassword = (user.passwordHash ?? '').trim();
  if (!storedPassword) {
    throw new AppError('Password akun belum terdaftar', 400);
  }

  const verifiedWithBcrypt = await verifyPassword(oldPassword, storedPassword);
  const verifiedWithLegacyPlainText = oldPassword == storedPassword;
  if (!verifiedWithBcrypt && !verifiedWithLegacyPlainText) {
    throw new AppError('Password lama salah', 401);
  }

  const nextHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: nextHash,
      updatedAt: new Date(),
    },
  });

  await AuditLogService.createLog({
    tenantId: req.user.tenantId,
    userId: req.user.userId,
    userName: req.user.email,
    actionType: 'CHANGE_PASSWORD',
    details: 'User changed password via auth endpoint',
  });

  return res.status(200).json({
    success: true,
    message: 'Password berhasil diperbarui',
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.tenantId) {
    throw new AppError('User not authenticated', 401);
  }

  await createAuditLogSafely({
    tenantId: (req.user?.tenantId ?? '').toString(),
    userId: (req.user?.userId ?? '').toString(),
    userName: (req.user?.email ?? '').toString(),
    actionType: 'USER_LOGOUT',
    details: 'User logout dari sistem',
  });

  return res.status(200).json({
    success: true,
    message: 'Logout berhasil',
  });
});