import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type { JwtAuthPayload } from '../types/auth';

// Login portal Super Admin tanpa Firebase: email + password (bcrypt di users.passwordHash),
// hasilnya JWT internal yang sama dengan yang dibaca authMiddleware.

const INVALID_LOGIN = 'Email atau password salah';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_PASSWORD_MIN_LENGTH = 8;
const DUMMY_HASH = bcrypt.hashSync('goldenity-dummy-password-never-matches', 12);

type AttemptState = { count: number; firstAt: number };
const failedAttempts = new Map<string, AttemptState>();

function attemptKey(email: string, ip: string): string {
  return `${email}|${ip}`;
}

function assertNotLocked(key: string) {
  const state = failedAttempts.get(key);
  if (!state) return;
  if (Date.now() - state.firstAt > LOCK_WINDOW_MS) {
    failedAttempts.delete(key);
    return;
  }
  if (state.count >= MAX_FAILED_ATTEMPTS) {
    throw new AppError('Terlalu banyak percobaan login. Coba lagi dalam 15 menit.', 429);
  }
}

function recordFailure(key: string) {
  const now = Date.now();
  const state = failedAttempts.get(key);
  if (!state || now - state.firstAt > LOCK_WINDOW_MS) {
    failedAttempts.set(key, { count: 1, firstAt: now });
  } else {
    state.count += 1;
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new AppError('JWT_SECRET is not configured', 500);
  return secret;
}

export type AdminProfile = {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
};

function toProfile(user: { id: string; email: string | null; name: string; role: string; tenantId: string }): AdminProfile {
  return { id: user.id, email: user.email ?? '', name: user.name, role: user.role, tenantId: user.tenantId };
}

export async function loginAdmin(rawEmail: string, password: string, ip: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !password) throw new AppError(INVALID_LOGIN, 401);

  const key = attemptKey(email, ip);
  assertNotLocked(key);

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, role: 'SUPER_ADMIN' },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      isActive: true,
      passwordHash: true,
      tenant: { select: { isActive: true } },
    },
  });

  // Tetap jalankan bcrypt walau user tidak ada, supaya waktu respons tidak membocorkan email terdaftar.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    recordFailure(key);
    throw new AppError(INVALID_LOGIN, 401);
  }
  if (!user.isActive || !user.tenant.isActive) {
    throw new AppError('Akun ini sudah dinonaktifkan', 403);
  }

  failedAttempts.delete(key);

  const payload: JwtAuthPayload = {
    userId: user.id,
    tenantId: user.tenantId,
    role: 'SUPER_ADMIN',
    email: user.email ?? undefined,
    kind: 'admin',
  };
  const expiresIn = (process.env.ADMIN_JWT_EXPIRES_IN?.trim() || '12h') as jwt.SignOptions['expiresIn'];
  const token = jwt.sign(payload, getJwtSecret(), { expiresIn });

  return { token, user: toProfile(user) };
}

export async function getAdminProfile(userId: string): Promise<AdminProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, tenantId: true, isActive: true },
  });
  if (!user || !user.isActive || user.role !== 'SUPER_ADMIN') {
    throw new AppError('Sesi tidak valid. Silakan login ulang.', 401);
  }
  return toProfile(user);
}

export async function changeAdminPassword(userId: string, oldPassword: string, newPassword: string) {
  if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new AppError(`Password baru minimal ${ADMIN_PASSWORD_MIN_LENGTH} karakter`, 400);
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, passwordHash: true } });
  if (!user || user.role !== 'SUPER_ADMIN') throw new AppError('User tidak ditemukan', 404);
  if (!user.passwordHash || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
    throw new AppError('Password lama tidak benar', 401);
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

/** Untuk testing: kosongkan penghitung percobaan gagal. */
export function resetAdminLoginAttempts() {
  failedAttempts.clear();
}

export const AdminAuthService = { loginAdmin, getAdminProfile, changeAdminPassword };
