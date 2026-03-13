import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { firebaseAuth } from '../config/firebase';

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

    if (newPassword.length < 8) {
      throw new AppError('Password baru minimal 8 karakter', 400);
    }

    if (newPassword !== confirmPassword) {
      throw new AppError(
        'Konfirmasi password baru tidak cocok',
        400,
      );
    }

    // req.user is set by authMiddleware (Firebase)
    const uid = req.user?.uid;
    if (!uid) {
      throw new AppError('User tidak terautentikasi', 401);
    }

    // Look up the Super Admin in the database
    const superAdmin = await prisma.user.findUnique({
      where: { firebaseUid: uid },
    });

    if (!superAdmin) {
      throw new AppError('User tidak ditemukan', 404);
    }

    if (superAdmin.role !== 'SUPER_ADMIN') {
      throw new AppError('Hanya SUPER_ADMIN yang dapat menggunakan endpoint ini', 403);
    }

    // Validate old password: if passwordHash is stored, verify against it.
    // On first change (passwordHash is null), we skip local DB check and rely
    // on Firebase re-authentication having been done on the frontend.
    if (superAdmin.passwordHash) {
      const isOldPasswordValid = await bcrypt.compare(
        oldPassword,
        superAdmin.passwordHash,
      );
      if (!isOldPasswordValid) {
        throw new AppError('Password lama tidak benar', 401);
      }
    }

    // Update password in Firebase
    await firebaseAuth.updateUser(uid, { password: newPassword });

    // Store new bcrypt hash in DB for future local validation
    const newHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { firebaseUid: uid },
      data: { passwordHash: newHash },
    });

    return res.status(200).json({
      success: true,
      message: 'Password Super Admin berhasil diubah',
    });
  },
);
