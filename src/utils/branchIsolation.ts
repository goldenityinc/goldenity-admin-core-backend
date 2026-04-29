import { Request } from 'express';
import { AppError } from './AppError';

const BRANCH_RESTRICTED_ROLES = new Set(['CASHIER', 'CRM_STAFF']);

function normalizeRole(rawRole: unknown): string {
  return (rawRole ?? '').toString().trim().toUpperCase();
}

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

  const role = normalizeRole(user.role);
  const isTenantAdminHq = role === 'TENANT_ADMIN' && user.isHQ === true;

  if (isTenantAdminHq) {
    const queryBranchId = req.query.branchId;
    if (queryBranchId && typeof queryBranchId === 'string' && /^\d+$/.test(queryBranchId)) {
      return BigInt(queryBranchId);
    }
    // TENANT_ADMIN + HQ boleh lintas cabang.
    return null;
  }

  const mustRestrictToBranch = BRANCH_RESTRICTED_ROLES.has(role) || user.isHQ !== true;
  if (!mustRestrictToBranch) {
    const queryBranchId = req.query.branchId;
    if (queryBranchId && typeof queryBranchId === 'string' && /^\d+$/.test(queryBranchId)) {
      return BigInt(queryBranchId);
    }
    return null;
  }

  // Role/caller yang wajib branch scope harus punya branchId di JWT.
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
