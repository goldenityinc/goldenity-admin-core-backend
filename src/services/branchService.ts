import prisma from '../config/database';
import { AppError } from '../utils/AppError';

function isBranchCodeUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; message?: string; target?: unknown };
  };

  const message = `${candidate.message ?? ''} ${candidate.meta?.message ?? ''}`.toLowerCase();
  const target = Array.isArray(candidate.meta?.target) ? candidate.meta?.target.join(',').toLowerCase() : '';

  return (
    candidate.code === '23505' ||
    candidate.meta?.code === '23505' ||
    target.includes('branch_code') ||
    message.includes('branch_code') ||
    message.includes('branches_branch_code_key')
  );
}

function throwFriendlyBranchCodeError(error: unknown): never {
  if (isBranchCodeUniqueViolation(error)) {
    throw new AppError('Branch Code sudah digunakan. Silakan gunakan kode lain.', 400);
  }

  throw error;
}

type BranchPayload = {
  name: string;
  branchCode?: string | null;
  address?: string | null;
  phone?: string | null;
  isActive?: boolean;
};

type UpdateBranchPayload = {
  name?: string;
  branchCode?: string | null;
  address?: string | null;
  phone?: string | null;
  isActive?: boolean;
};

type BranchRow = {
  id: bigint;
  tenantId: string;
  name: string;
  branchCode: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type CountRow = {
  count: bigint;
};

export class BranchService {
  static async createBranch(tenantId: string, payload: BranchPayload) {
    try {
      const rows = await prisma.$queryRaw<BranchRow[]>`
        INSERT INTO "branches" (
          "tenant_id",
          "name",
          "branch_code",
          "address",
          "phone",
          "is_active"
        )
        VALUES (
          ${tenantId},
          ${payload.name},
          ${payload.branchCode ?? null},
          ${payload.address ?? null},
          ${payload.phone ?? null},
          ${payload.isActive ?? true}
        )
        RETURNING
          "id",
          "tenant_id" AS "tenantId",
          "name",
          "branch_code" AS "branchCode",
          "address",
          "phone",
          "is_active" AS "isActive",
          "created_at" AS "createdAt",
          "updated_at" AS "updatedAt"
      `;

      return rows[0];
    } catch (error: unknown) {
      throwFriendlyBranchCodeError(error);
    }
  }

  static async listBranches(tenantId: string) {
    return prisma.$queryRaw<BranchRow[]>`
      SELECT
        "id",
        "tenant_id" AS "tenantId",
        "name",
        "branch_code" AS "branchCode",
        "address",
        "phone",
        "is_active" AS "isActive",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "branches"
      WHERE "tenant_id" = ${tenantId}
      ORDER BY "is_active" DESC, "name" ASC
    `;
  }

  static async getBranchById(tenantId: string, branchId: bigint) {
    const rows = await prisma.$queryRaw<BranchRow[]>`
      SELECT
        "id",
        "tenant_id" AS "tenantId",
        "name",
        "branch_code" AS "branchCode",
        "address",
        "phone",
        "is_active" AS "isActive",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "branches"
      WHERE "id" = ${branchId} AND "tenant_id" = ${tenantId}
      LIMIT 1
    `;

    const branch = rows[0];

    if (!branch) {
      throw new AppError('Branch tidak ditemukan', 404);
    }

    return branch;
  }

  static async updateBranch(tenantId: string, branchId: bigint, payload: UpdateBranchPayload) {
    const existing = await this.getBranchById(tenantId, branchId);
    try {
      const rows = await prisma.$queryRaw<BranchRow[]>`
        UPDATE "branches"
        SET
          "name" = ${payload.name ?? existing.name},
          "branch_code" = ${payload.branchCode !== undefined ? payload.branchCode : existing.branchCode},
          "address" = ${payload.address !== undefined ? payload.address : existing.address},
          "phone" = ${payload.phone !== undefined ? payload.phone : existing.phone},
          "is_active" = ${payload.isActive ?? existing.isActive},
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${branchId} AND "tenant_id" = ${tenantId}
        RETURNING
          "id",
          "tenant_id" AS "tenantId",
          "name",
          "branch_code" AS "branchCode",
          "address",
          "phone",
          "is_active" AS "isActive",
          "created_at" AS "createdAt",
          "updated_at" AS "updatedAt"
      `;

      return rows[0];
    } catch (error: unknown) {
      throwFriendlyBranchCodeError(error);
    }
  }

  static async deleteBranch(tenantId: string, branchId: bigint) {
    await this.getBranchById(tenantId, branchId);

    const countRows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "sales_records"
      WHERE "tenant_id" = ${tenantId}
        AND (
          "branch_id" = ${branchId}
          OR "target_pickup_branch_id" = ${branchId}
        )
    `;

    const activeSalesCount = Number(countRows[0]?.count ?? BigInt(0));

    if (activeSalesCount > 0) {
      throw new AppError('Branch sudah dipakai transaksi dan tidak bisa dihapus', 409);
    }

    await prisma.$executeRaw`
      DELETE FROM "branches"
      WHERE "id" = ${branchId} AND "tenant_id" = ${tenantId}
    `;
  }
}