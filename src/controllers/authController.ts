import type { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { loginSchema } from '../validations/authValidation';

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

  return res.status(200).json({
    success: true,
    token: result.token,
    tokenType: result.tokenType,
    expiresIn: result.expiresIn,
    user: result.user,
    tenant: result.tenant,
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