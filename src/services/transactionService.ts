import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';

const transactionRecordSelect = Prisma.validator<Prisma.sales_recordsSelect>()({
  id: true,
  tenant_id: true,
  branch_id: true,
  table_id: true,
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
  cashier_note: true,
  mechanic_id: true,
  mechanic_name: true,
  mechanic_commission: true,
  payment_status: true,
  items_json: true,
  customer_name: true,
  order_note: true,
  total_discount: true,
  total_tax: true,
  total_profit: true,
  amount_paid: true,
  payment_proof_url: true,
  branch: {
    select: {
      id: true,
      name: true,
    },
  },
  table: {
    select: {
      id: true,
      table_number: true,
      status: true,
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
  mechanic_id: true,
  employee_id: true,
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
  order_status: OrderStatus;
  transaction_status: OrderStatus;
  is_void: boolean;
  isVoid: boolean;
  table_number: string | null;
  items: Array<
    TransactionItemRow & {
      product_type: string | null;
    }
  >;
};

type TransactionNotesUpdate = {
  cashier_note?: string | null;
  order_note?: string | null;
};

export class TransactionService {
  private static async ensureSalesRecordNoteColumns() {
    await prisma.$executeRawUnsafe(`ALTER TABLE sales_records
      ADD COLUMN IF NOT EXISTS cashier_note TEXT,
      ADD COLUMN IF NOT EXISTS order_note TEXT`);
  }

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
      order_status: record.order_status,
      transaction_status: record.order_status,
      is_void: record.order_status === 'CANCELLED',
      isVoid: record.order_status === 'CANCELLED',
      cashier_note: record.cashier_note ?? null,
      cashierNote: record.cashier_note ?? null,
      order_note: record.order_note ?? null,
      special_note: record.order_note ?? null,
      specialNote: record.order_note ?? null,
      table_number: record.table?.table_number ?? null,
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

    await this.ensureSalesRecordNoteColumns();

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

    await this.ensureSalesRecordNoteColumns();

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

  static async updateTransactionNotes(
    tenantId: string,
    id: bigint,
    branchId: bigint | null,
    notes: TransactionNotesUpdate,
    requireScopedBranch = false,
  ) {
    if (requireScopedBranch && branchId === null) {
      throw new AppError(
        'Akses ditolak: konteks cabang wajib tersedia untuk akun ini',
        403,
      );
    }

    await this.ensureSalesRecordNoteColumns();

    const data: Prisma.sales_recordsUpdateManyMutationInput = {
      updated_at: new Date(),
    };

    if (Object.prototype.hasOwnProperty.call(notes, 'cashier_note')) {
      data.cashier_note = notes.cashier_note ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(notes, 'order_note')) {
      data.order_note = notes.order_note ?? null;
    }

    const updated = await prisma.sales_records.updateMany({
      where: {
        id,
        tenant_id: tenantId,
        ...(branchId !== null ? { branch_id: branchId } : {}),
      },
      data,
    });

    if (updated.count !== 1) {
      return null;
    }

    return this.getTransactionById(tenantId, id, branchId, requireScopedBranch);
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

    let updatedRecord: TransactionRecordWithBranch | null = null;

    await prisma.$transaction(
      async (tx) => {
        const existingRecord = await tx.sales_records.findFirst({
          where: {
            id,
            tenant_id: tenantId,
            ...(branchId !== null ? { branch_id: branchId } : {}),
          },
        });

        if (!existingRecord) {
          throw new AppError('Transaction tidak ditemukan', 404);
        }

        const currentOrderStatus = (existingRecord.order_status ?? '')
          .toString()
          .trim()
          .toUpperCase();
        const rawIsVoid = (
          existingRecord as unknown as { is_void?: boolean; isVoid?: boolean }
        ).is_void ?? (
          existingRecord as unknown as { is_void?: boolean; isVoid?: boolean }
        ).isVoid;

        if (
          currentOrderStatus === 'CANCELLED' ||
          currentOrderStatus === 'VOID' ||
          rawIsVoid === true
        ) {
          throw new AppError('TRANSACTION_ALREADY_VOIDED', 409);
        }

        const updateResult = await tx.sales_records.updateMany({
          where: {
            id,
            tenant_id: tenantId,
            ...(branchId !== null ? { branch_id: branchId } : {}),
            NOT: {
              order_status: 'CANCELLED',
            },
          },
          data: {
            order_status: 'CANCELLED',
            updated_at: new Date(),
          },
        });

        if (updateResult.count !== 1) {
          throw new AppError('TRANSACTION_ALREADY_VOIDED', 409);
        }

        const soldItems = await tx.sales_record_items.findMany({
          where: {
            tenant_id: tenantId,
            sales_record_id: id,
          },
          select: {
            product_id: true,
            qty: true,
            is_service: true,
          },
        });

        const productIds = Array.from(
          new Set(
            soldItems
              .map((item) => item.product_id?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        );

        const trackedProducts = productIds.length > 0
          ? await tx.products.findMany({
              where: {
                tenant_id: tenantId,
                id: { in: productIds },
              },
              select: {
                id: true,
                is_stock_tracked: true,
              },
            })
          : [];

        const isStockTrackedByProductId = new Map(
          trackedProducts.map((product) => [product.id, product.is_stock_tracked !== false]),
        );

        for (const item of soldItems) {
          if (item.is_service || !item.product_id) {
            continue;
          }

          if (isStockTrackedByProductId.get(item.product_id) === false) {
            continue;
          }

          const qty = Number(item.qty ?? 0);
          if (!Number.isFinite(qty) || qty <= 0) {
            continue;
          }

          await tx.products.updateMany({
            where: {
              tenant_id: tenantId,
              id: item.product_id,
            },
            data: {
              stock: {
                increment: qty,
              },
              updated_at: new Date(),
            },
          });
        }

        updatedRecord = await tx.sales_records.findFirst({
          where: {
            id,
            tenant_id: tenantId,
            ...(branchId !== null ? { branch_id: branchId } : {}),
          },
          select: transactionRecordSelect,
        });

        if (!updatedRecord) {
          throw new AppError('Transaction tidak ditemukan setelah pembatalan', 404);
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (!updatedRecord) {
      throw new AppError('Transaction tidak ditemukan setelah pembatalan', 404);
    }

    console.log(
      `[TransactionService.cancelTransaction] Transaction cancelled successfully. ID=${id} TenantId=${tenantId}`
    );

    const [enrichedRecord] = await this.enrichTransactionsWithNames(tenantId, [updatedRecord]);
    const [recordWithItems] = await this.attachTransactionItems(
      tenantId,
      enrichedRecord ? [enrichedRecord] : [],
    );

    return recordWithItems ?? updatedRecord;
  }
}
