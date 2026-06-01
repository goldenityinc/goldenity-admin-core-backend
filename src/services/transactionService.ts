import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';

const transactionRecordSelect = Prisma.validator<Prisma.sales_recordsSelect>()({
  id: true,
  tenant_id: true,
  branch_id: true,
  shift_id: true,
  reference_id: true,
  payment_method: true,
  payment_type: true,
  transaction_type: true,
  order_type: true,
  order_status: true,
  po_status: true,
  dp_amount: true,
  pickup_date: true,
  target_pickup_branch_id: true,
  total_price: true,
  total_amount: true,
  remaining_balance: true,
  outstanding_balance: true,
  created_at: true,
  updated_at: true,
  receipt_number: true,
  cashier_id: true,
  cashier_name: true,
  mechanic_id: true,
  mechanic_name: true,
  mechanic_commission: true,
  payment_status: true,
  items_json: true,
  customer_name: true,
  total_discount: true,
  total_tax: true,
  total_profit: true,
  amount_paid: true,
  branch: {
    select: {
      id: true,
      name: true,
    },
  },
});

const transactionItemSelect = Prisma.validator<Prisma.sales_record_itemsSelect>()({
  id: true,
  sales_record_id: true,
  product_id: true,
  product_name: true,
  qty: true,
  custom_price: true,
  note: true,
  item_note: true,
  is_service: true,
  is_custom_item: true,
  custom_name: true,
  created_at: true,
  updated_at: true,
});

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
  select: typeof transactionRecordSelect;
}>;

type TransactionItemRow = Prisma.sales_record_itemsGetPayload<{
  select: typeof transactionItemSelect;
}>;

type TransactionRecordRow = TransactionRecordWithBranch & {
  cashierDisplayName?: string | null;
  cashierName?: string | null;
  branchName?: string | null;
};

type TransactionRecordResponse = TransactionRecordRow & {
  status: OrderStatus;
  items: Array<
    TransactionItemRow & {
      product_type: string | null;
    }
  >;
};

export class TransactionService {
  private static async attachTransactionItems(
    tenantId: string,
    records: TransactionRecordRow[],
  ): Promise<TransactionRecordResponse[]> {
    if (records.length === 0) {
      return [];
    }

    const recordIds = records.map((record) => record.id);

    const items = await prisma.sales_record_items.findMany({
      where: {
        tenant_id: tenantId,
        sales_record_id: {
          in: recordIds,
        },
      },
      select: transactionItemSelect,
      orderBy: [
        { sales_record_id: 'asc' },
        { id: 'asc' },
      ],
    });

    const productIds = Array.from(
      new Set(
        items
          .map((item) => item.product_id?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const products = productIds.length
      ? await prisma.products.findMany({
          where: {
            tenant_id: tenantId,
            id: {
              in: productIds,
            },
          },
          select: {
            id: true,
            product_type: true,
          },
        })
      : [];

    const productTypeMap = new Map(products.map((product) => [product.id, product.product_type]));

    const itemsByTransactionId = new Map<string, TransactionRecordResponse['items']>();

    for (const item of items) {
      const saleIdKey = item.sales_record_id.toString();
      const mappedItems = itemsByTransactionId.get(saleIdKey) ?? [];

      mappedItems.push({
        ...item,
        // Product type is sourced from products table; item flags come directly from sales_record_items.
        product_type: item.product_id ? productTypeMap.get(item.product_id) ?? null : null,
        is_service: item.is_service,
      });

      itemsByTransactionId.set(saleIdKey, mappedItems);
    }

    return records.map((record) => ({
      ...record,
      status: record.order_status,
      items: itemsByTransactionId.get(record.id.toString()) ?? [],
    }));
  }

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
        select: transactionRecordSelect,
        orderBy: { created_at: 'desc' },
        skip,
        take: safeLimit,
      }),
      prisma.sales_records.count({ where }),
    ]);

    const enrichedRecords = await this.enrichTransactionsWithNames(tenantId, records);
    const recordsWithItems = await this.attachTransactionItems(tenantId, enrichedRecords);

    return {
      records: recordsWithItems,
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
      select: transactionRecordSelect,
    });

    if (!record) {
      return null;
    }

    const [enrichedRecord] = await this.enrichTransactionsWithNames(tenantId, [record]);
    const [recordWithItems] = await this.attachTransactionItems(
      tenantId,
      enrichedRecord ? [enrichedRecord] : [],
    );

    return recordWithItems ?? null;
  }

  /**
   * Cancel/Void a transaction by updating its status to CANCELLED.
   * This should be called AFTER inventory has been restored.
   * Returns the updated transaction record.
   */
  static async cancelTransaction(
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

    // Verify transaction exists and belongs to this tenant/branch
    const existingRecord = await prisma.sales_records.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        ...(branchId !== null ? { branch_id: branchId } : {}),
      },
    });

    if (!existingRecord) {
      throw new AppError('Transaction tidak ditemukan', 404);
    }

    // Prevent double-cancellation
    if (existingRecord.order_status === 'CANCELLED') {
      throw new AppError('Transaksi sudah dibatalkan sebelumnya', 400);
    }

    console.log(
      `[TransactionService.cancelTransaction] Cancelling transaction ID=${id}, TenantId=${tenantId}. Old Status=${existingRecord.order_status}`
    );

    // Update status to CANCELLED and return updated record
    const updatedRecord = await prisma.sales_records.update({
      where: { id },
      data: {
        order_status: 'CANCELLED',
        updated_at: new Date(),
      },
      select: transactionRecordSelect,
    });

    console.log(
      `[TransactionService.cancelTransaction] Transaction cancelled successfully. New Status=${updatedRecord.order_status}`
    );

    const [enrichedRecord] = await this.enrichTransactionsWithNames(tenantId, [updatedRecord]);
    const [recordWithItems] = await this.attachTransactionItems(
      tenantId,
      enrichedRecord ? [enrichedRecord] : [],
    );

    return recordWithItems ?? updatedRecord;
  }
}
