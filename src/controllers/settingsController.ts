import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { AdminAuthService } from '../services/adminAuthService';

export const changeSuperAdminPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { oldPassword, newPassword, confirmPassword } =
      req.body as {
        oldPassword?: string;
        newPassword?: string;
        confirmPassword?: string;
      };

    if (!oldPassword || !newPassword || !confirmPassword) {
      throw new AppError(
        'oldPassword, newPassword, dan confirmPassword harus diisi',
        400,
      );
    }

    if (newPassword !== confirmPassword) {
      throw new AppError('Konfirmasi password baru tidak cocok', 400);
    }

    // Token login backend membawa userId; token Firebase lama (masa transisi) membawa uid.
    let userId = req.user?.userId;
    if (!userId && req.user?.uid) {
      const byUid = await prisma.user.findUnique({ where: { firebaseUid: req.user.uid }, select: { id: true } });
      userId = byUid?.id;
    }
    if (!userId) {
      throw new AppError('User tidak terautentikasi', 401);
    }

    // Password hanya disimpan di backend (bcrypt); Firebase tidak lagi dipakai.
    await AdminAuthService.changeAdminPassword(userId, oldPassword, newPassword);

    return res.status(200).json({
      success: true,
      message: 'Password Super Admin berhasil diubah',
    });
  },
);
