import type { Request, Response } from 'express';
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

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  return res.status(200).json({
    success: true,
    data: req.user,
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

  return res.status(200).json({
    success: true,
    user: {
      tier,
      addons,
    },
    subscription: {
      tier,
      addons,
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