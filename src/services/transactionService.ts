import { Prisma } from '@prisma/client';
import prisma from '../config/database';

export type TransactionListFilters = {
  tenantId: string;
  /**
   * null  = HQ user without branch restriction (sees ALL branches for this tenant)
   * bigint = filter to this specific branch only
   */
  branchId: bigint | null;
  startDate?: Date;
  endDate?: Date;
  orderStatus?: string;
  orderType?: string;
  page?: number;
  limit?: number;
};

export class TransactionService {
  /**
   * List sales records with mandatory branch isolation.
   * Non-HQ callers must always pass a branchId (resolved from JWT via resolveBranchFilter).
   * HQ callers may pass null to see all branches.
   */
  static async listTransactions(filters: TransactionListFilters) {
    const {
      tenantId,
      branchId,
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

    const where: Prisma.sales_recordsWhereInput = {
      tenant_id: tenantId,
      ...(branchId !== null ? { branch_id: branchId } : {}),
      ...(startDate || endDate
        ? {
            created_at: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
      ...(orderStatus ? { order_status: orderStatus as Prisma.EnumOrderStatusFilter } : {}),
      ...(orderType ? { order_type: orderType as Prisma.EnumOrderTypeFilter } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.sales_records.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: safeLimit,
        select: {
          id: true,
          tenant_id: true,
          branch_id: true,
          target_pickup_branch_id: true,
          reference_id: true,
          receipt_number: true,
          payment_method: true,
          payment_type: true,
          payment_status: true,
          order_type: true,
          order_status: true,
          total_price: true,
          total_amount: true,
          amount_paid: true,
          remaining_balance: true,
          outstanding_balance: true,
          total_discount: true,
          total_tax: true,
          total_profit: true,
          cashier_id: true,
          cashier_name: true,
          customer_name: true,
          pickup_date: true,
          created_at: true,
          updated_at: true,
        },
      }),
      prisma.sales_records.count({ where }),
    ]);

    return {
      records,
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
  ) {
    const record = await prisma.sales_records.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        ...(branchId !== null ? { branch_id: branchId } : {}),
      },
    });

    return record ?? null;
  }
}
