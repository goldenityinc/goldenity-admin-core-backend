import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { firebaseAuth } from '../config/firebase';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import { isJwtAuthPayload } from '../types/auth';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid?: string;
        userId?: string;
        email?: string;
        tenantId: string;
        role?: string;
        tier?: string | null;
        addons?: string[];
        entitlementsRevision?: number;
        activeModules?: string[];
      };
    }
  }
}

export const verifyToken = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided. Please login first.', 401);
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError('Invalid token format', 401);
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new AppError('JWT_SECRET is not configured', 500);
    }

    const decoded = jwt.verify(token, jwtSecret);
    if (!isJwtAuthPayload(decoded)) {
      throw new AppError('Invalid token payload', 401);
    }

    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      tier: decoded.tier,
      addons: decoded.addons,
      entitlementsRevision: decoded.entitlementsRevision,
      activeModules: decoded.activeModules,
    };

    next();
  } catch (error: any) {
    if (error?.name === 'TokenExpiredError') {
      return next(new AppError('Token has expired. Please login again.', 401));
    }

    if (error?.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token', 401));
    }

    return next(error);
  }
};

/**
 * Middleware untuk verifikasi Firebase ID Token dan ekstraksi tenantId
 * 
 * Flow:
 * 1. Ambil token dari header Authorization (Bearer token)
 * 2. Verifikasi token menggunakan Firebase Admin SDK
 * 3. Ambil firebase_uid dari token
 * 4. Cari user di database berdasarkan firebase_uid untuk mendapatkan tenantId
 * 5. Attach user info (uid, email, tenantId, role) ke req.user
 */
export const authMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    // 1. Ambil token dari header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided. Please login first.', 401);
    }

    const token = authHeader.split('Bearer ')[1];

    if (!token) {
      throw new AppError('Invalid token format', 401);
    }

    // Prioritaskan JWT internal backend agar token dari /auth/login bisa dipakai lintas endpoint.
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      try {
        const decoded = jwt.verify(token, jwtSecret);
        if (isJwtAuthPayload(decoded)) {
          req.user = {
            userId: decoded.userId,
            tenantId: decoded.tenantId,
            role: decoded.role,
            tier: decoded.tier,
            addons: decoded.addons,
          };

          return next();
        }
      } catch {
        // Bukan JWT internal, lanjutkan ke validasi Firebase.
      }
    }

    // 2. Verifikasi token dengan Firebase
    const decodedToken = await firebaseAuth.verifyIdToken(token);
    const { uid } = decodedToken;

    // 3. Cari user di database berdasarkan firebase_uid
    const user = await prisma.user.findUnique({
      where: { firebaseUid: uid },
      include: {
        tenant: true, // Include tenant info
      },
    });

    // 4. Validasi user
    if (!user) {
      throw new AppError(
        'User not found in database. Please contact administrator.',
        404
      );
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated.', 403);
    }

    if (!user.tenant.isActive) {
      throw new AppError('Your tenant account has been deactivated.', 403);
    }

    // 5. Attach user info ke request
    req.user = {
      uid: user.firebaseUid ?? undefined,
      email: user.email ?? undefined,
      tenantId: user.tenantId,
      role: user.role,
    };

    next();
  } catch (error: any) {
    // Handle Firebase errors
    if (error.code === 'auth/id-token-expired') {
      return next(new AppError('Token has expired. Please login again.', 401));
    }
    
    if (error.code === 'auth/argument-error') {
      return next(new AppError('Invalid token format', 401));
    }

    // Pass error to global error handler
    next(error);
  }
};

/**
 * Middleware untuk role-based access control
 * 
 * @param allowedRoles - Array of roles yang diizinkan (contoh: ['TENANT_ADMIN', 'SUPER_ADMIN'])
 */
export const roleMiddleware = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('User not authenticated', 401));
    }

    if (!req.user.role) {
      return next(new AppError('Role is missing in authenticated user', 403));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to access this resource', 403)
      );
    }

    next();
  };
};

/**
 * Middleware untuk memastikan user hanya bisa akses data tenant mereka sendiri
 * Kecuali SUPER_ADMIN yang bisa akses semua tenant
 */
export const tenantMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError('User not authenticated', 401));
  }

  // SUPER_ADMIN bisa akses semua tenant
  if (req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  // Untuk role lain, validasi tenantId
  const requestedTenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;

  if (requestedTenantId && requestedTenantId !== req.user.tenantId) {
    return next(
      new AppError('You do not have permission to access this tenant data', 403)
    );
  }

  next();
};

/**
 * Middleware untuk memeriksa subscription tier tenant.
 * SUPER_ADMIN selalu lolos. Tenant lain harus memiliki AppInstance aktif
 * dengan tier yang termasuk dalam allowedTiers.
 * Contoh: tierMiddleware('Professional', 'Enterprise')
 */
export const tierMiddleware = (...allowedTiers: string[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user?.tenantId) {
      return next(new AppError('User not authenticated', 401));
    }

    // SUPER_ADMIN bypass tier check
    if (req.user.role === 'SUPER_ADMIN') return next();

    const appInstance = await prisma.appInstance.findFirst({
      where: { tenantId: req.user.tenantId, status: 'ACTIVE' },
      select: { tier: true },
    });

    if (!appInstance) {
      return next(new AppError('No active subscription found for this tenant', 403));
    }

    if (!allowedTiers.includes(appInstance.tier as string)) {
      return next(
        new AppError(
          `Fitur ini memerlukan paket ${allowedTiers.join(' atau ')}. Upgrade untuk mengakses.`,
          403,
        ),
      );
    }

    next();
  };
};
