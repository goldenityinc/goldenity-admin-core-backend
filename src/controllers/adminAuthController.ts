import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { AdminAuthService } from '../services/adminAuthService';

/** POST /api/auth/admin/login — { email, password } → { token, user } */
export const adminLogin = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new AppError('Email dan password wajib diisi', 400);
  }
  const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').toString();
  const result = await AdminAuthService.loginAdmin(email, password, ip);
  res.status(200).json({ success: true, data: result });
});

/** GET /api/auth/admin/me — profil Super Admin dari token. */
export const adminMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  if (!userId) throw new AppError('Sesi tidak valid. Silakan login ulang.', 401);
  const user = await AdminAuthService.getAdminProfile(userId);
  res.status(200).json({ success: true, data: { user } });
});
