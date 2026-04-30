import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';

export type TransactionListFilters = {
  tenantId: string;
  /**
   * null  = HQ user without branch restriction (sees ALL branches for this tenant)
   * bigint = filter to this specific branch only
   */
  branchId: bigint | null;
  requireScopedBranch?: boolean;
  requireAssignedBranch?: boolean;
  startDate?: Date;
  endDate?: Date;
  orderStatus?: OrderStatus;
  orderType?: OrderType;
  page?: number;
  limit?: number;
};

type TransactionRecordWithBranch = Prisma.sales_recordsGetPayload<{
  include: {
    branch: {
      select: {
        id: true;
        name: true;
      };
    };
  };
}>;

type TransactionRecordRow = TransactionRecordWithBranch & {
  cashierDisplayName?: string | null;
  cashierName?: string | null;
  branchName?: string | null;
};

export class TransactionService {
  private static async enrichTransactionsWithNames(
    tenantId: string,
    records: TransactionRecordWithBranch[],
  ): Promise<TransactionRecordRow[]> {
    if (records.length === 0) {
      return [];
    }

    const cashierIds = Array.from(
      new Set(
        records
          .map((record) => record.cashier_id?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const users = cashierIds.length
      ? await prisma.user.findMany({
          where: {
            tenantId,
            id: { in: cashierIds },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : [];

    const userMap = new Map(users.map((user) => [user.id, user.name]));

    return records.map((record) => {
      const cashierId = record.cashier_id?.trim() || '';
      const cashierDisplayName =
        userMap.get(cashierId) ??
        record.cashier_name?.trim() ??
        null;

      return {
        ...record,
        cashierDisplayName,
        cashierName: cashierDisplayName,
        branchName: record.branch?.name?.trim() || null,
      };
    });
  }

  /**
   * List sales records with mandatory branch isolation.
   * Non-HQ callers must always pass a branchId (resolved from JWT via resolveBranchFilter).
   * HQ callers may pass null to see all branches.
   */
  static async listTransactions(filters: TransactionListFilters) {
    const {
      tenantId,
      branchId,
      requireScopedBranch = false,
      requireAssignedBranch = false,
      startDate,
      endDate,
      orderStatus,
      orderType,
      page = 1,
      limit = 50,
    } = filters;

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const skip = (safePage - 1) * safeLimit;

    if (requireScopedBranch && branchId === null) {
      throw new AppError(
        'Akses ditolak: konteks cabang wajib tersedia untuk akun ini',
        403,
      );
    }

    const where: Prisma.sales_recordsWhereInput = {
      tenant_id: tenantId,
      ...(branchId !== null ? { branch_id: branchId } : {}),
      ...(branchId === null && requireAssignedBranch ? { branch_id: { not: null } } : {}),
      ...(startDate || endDate
        ? {
            created_at: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
      ...(orderStatus ? { order_status: orderStatus } : {}),
      ...(orderType ? { order_type: orderType } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.sales_records.findMany({
        where,
        include: {
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: safeLimit,
      }),
      prisma.sales_records.count({ where }),
    ]);

    const enrichedRecords = await this.enrichTransactionsWithNames(tenantId, records);

    return {
      records: enrichedRecords,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Get a single sales record by ID.
   * branchId filter is enforced: non-HQ users can only retrieve records belonging to their branch.
   */
  static async getTransactionById(
    tenantId: string,
    id: bigint,
    branchId: bigint | null,
    requireScopedBranch = false,
  ) {
    if (requireScopedBranch && branchId === null) {
      throw new AppError(
        'Akses ditolak: konteks cabang wajib tersedia untuk akun ini',
        403,
      );
    }

    const record = await prisma.sales_records.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        ...(branchId !== null ? { branch_id: branchId } : {}),
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!record) {
      return null;
    }

    const [enrichedRecord] = await this.enrichTransactionsWithNames(tenantId, [record]);
    return enrichedRecord ?? null;
  }
}
