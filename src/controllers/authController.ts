import type { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { loginSchema } from '../validations/authValidation';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
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