import { Request } from 'express';
import { AppError } from './AppError';

/**
 * Resolves the branch filter for POS operational data queries.
 *
 * Rules:
 * - HQ users (isHQ: true) WITHOUT a query param `branchId` → return null (no branch filter, sees all branches)
 * - HQ users WITH a valid query param `branchId`            → return that specific branchId as BigInt
 * - Non-HQ users (Kasir, CRM_STAFF, etc.)                  → MUST use branchId from JWT; throw 403 if missing
 *
 * @returns bigint  – filter by this specific branch
 * @returns null    – HQ user with no branch restriction (sees all branches for tenant)
 */
export function resolveBranchFilter(req: Request): bigint | null {
  const user = req.user;

  if (!user) {
    throw new AppError('Unauthenticated', 401);
  }

  if (user.isHQ === true) {
    const queryBranchId = req.query.branchId;
    if (queryBranchId && typeof queryBranchId === 'string' && /^\d+$/.test(queryBranchId)) {
      return BigInt(queryBranchId);
    }
    // HQ with no specific branch param → no restriction
    return null;
  }

  // Non-HQ user must have branchId in their JWT token
  if (!user.branchId) {
    throw new AppError(
      'Akses ditolak: konteks cabang tidak tersedia pada akun ini',
      403,
    );
  }

  if (!/^\d+$/.test(user.branchId)) {
    throw new AppError('Branch ID pada token tidak valid', 403);
  }

  return BigInt(user.branchId);
}
