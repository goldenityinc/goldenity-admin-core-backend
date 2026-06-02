import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type { CreateSaleInput } from '../validations/salesValidation';

type SaleItemPayload = CreateSaleInput['items'][number];

type BranchLookupRow = {
  id: bigint;
};

type ShiftLookupRow = {
  id: bigint;
  branch_id: bigint;
};

type SaleRow = {
  id: bigint;
  tenant_id: string | null;
  branch_id: bigint | null;
  reference_id: string | null;
  payment_method: string | null;
  payment_type: string | null;
  transaction_type: string | null;
  order_type: string;
  order_status: string;
  po_status: string | null;
  dp_amount: Prisma.Decimal | null;
  pickup_date: Date | null;
  target_pickup_branch_id: bigint | null;
  total_price: Prisma.Decimal | null;
  total_amount: Prisma.Decimal | null;
  remaining_balance: Prisma.Decimal | null;
  outstanding_balance: Prisma.Decimal | null;
  created_at: Date | null;
  updated_at: Date | null;
  receipt_number: string | null;
  cashier_id: string | null;
  cashier_name: string | null;
  mechanic_id: string | null;
  mechanic_name: string | null;
  mechanic_commission: Prisma.Decimal | null;
  payment_status: string | null;
  items_json: Prisma.JsonValue | null;
  customer_name: string | null;
  total_discount: bigint | null;
  total_tax: bigint | null;
  total_profit: bigint | null;
  amount_paid: Prisma.Decimal | null;
};

type SaleItemRow = {
  id: bigint;
  tenant_id: string | null;
  sales_record_id: bigint;
  product_id: string | null;
  product_name: string | null;
  qty: number;
  custom_price: Prisma.Decimal | null;
  note: string | null;
  item_note: string | null;
  is_service: boolean;
  created_at: Date | null;
  updated_at: Date | null;
  is_custom_item: boolean;
  custom_name: string | null;
  mechanic_id: string | null;
  employee_id: string | null;
};

type SaleItemRow = {
  id: bigint;
  tenant_id: string | null;
  sales_record_id: bigint;
  product_id: string | null;
  product_name: string | null;
  qty: number;
  is_custom_item: boolean;
  custom_name: string | null;
  custom_price: Prisma.Decimal | null;
  note: string | null;
  is_service: boolean;
  created_at: Date | null;
  updated_at: Date | null;
};

export type PreOrderListFilters = {
  tenantId: string;
  branchId: bigint | null;
  requireScopedBranch?: boolean;
  requireAssignedBranch?: boolean;
  page?: number;
  limit?: number;
};

export type PreOrderSummaryFilters = {
  tenantId: string;
  branchId: bigint | null;
  requireScopedBranch?: boolean;
  requireAssignedBranch?: boolean;
};

function toOptionalBigInt(value: string | number | null | undefined): bigint | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return BigInt(value);
}

function toOptionalDecimal(value: string | number | null | undefined): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Prisma.Decimal(value);
}

function toOptionalDate(value: string | Date | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeSaleItem(item: SaleItemPayload) {
  const customPrice = toOptionalDecimal(item.customPrice ?? undefined);
  const normalizedProductName = item.isCustomItem
    ? (item.customName ?? '').trim()
    : (item.productName?.trim() || null);

  // Custom price priority: frontend override > master product price
  // For custom items, default to 0 if not provided. For services/products, accept null (no override).
  const resolvedCustomPrice = 
    customPrice !== undefined && customPrice !== null 
      ? customPrice  // Always use provided custom price (both custom items and services)
      : (item.isCustomItem ? new Prisma.Decimal(0) : null);  // Default only for custom items

  // Extract mechanic_id or employee_id from frontend - CRITICAL: must be passed for service items
  const mechanicId = (item.mechanicId ?? item.employeeId ?? '').toString().trim() || null;

  return {
    product_id: item.isCustomItem ? null : item.productId ?? null,
    product_name: normalizedProductName,
    qty: item.qty,
    custom_price: resolvedCustomPrice,
    note: item.note ?? null,
    is_service: item.isService ?? false,
    is_custom_item: item.isCustomItem ?? false,
    custom_name: item.isCustomItem ? normalizedProductName : item.customName ?? null,
    mechanic_id: mechanicId,
    employee_id: mechanicId,
  };
}

export class SalesService {
  static async createSale(tenantId: string, payload: CreateSaleInput) {
    const branchId = toOptionalBigInt(payload.branchId ?? undefined);
    const shiftId = toOptionalBigInt(payload.shiftId ?? undefined);
    const targetPickupBranchId = toOptionalBigInt(payload.targetPickupBranchId ?? undefined);

    await this.ensureBranchOwnership(tenantId, branchId, 'branchId');
    await this.ensureBranchOwnership(tenantId, targetPickupBranchId, 'targetPickupBranchId');
    await this.ensureShiftOwnership(tenantId, shiftId, branchId);

    if (payload.orderType === 'PRE_ORDER' && !targetPickupBranchId && !branchId) {
      throw new AppError('PRE_ORDER wajib memiliki branchId atau targetPickupBranchId', 400);
    }

    const normalizedItems = payload.items.map(normalizeSaleItem);

    // Log items with custom prices for debugging
    const itemsWithCustomPrices = normalizedItems.filter(
      (item) => item.custom_price !== null && item.custom_price !== undefined
    );
    if (itemsWithCustomPrices.length > 0) {
      console.log(
        `[SalesService.createSale] Sale with ${itemsWithCustomPrices.length} items with custom prices:`,
        itemsWithCustomPrices.map((item) => ({
          productName: item.product_name,
          customPrice: item.custom_price?.toString(),
          isService: item.is_service,
        }))
      );
    }

    return prisma.$transaction(async (tx) => {
      const saleRows = await tx.$queryRaw<SaleRow[]>`
        INSERT INTO "sales_records" (
          "tenant_id",
          "branch_id",
          "shift_id",
          "reference_id",
          "payment_method",
          "payment_type",
          "transaction_type",
          "order_type",
          "order_status",
          "po_status",
          "dp_amount",
          "pickup_date",
          "target_pickup_branch_id",
          "total_price",
          "total_amount",
          "remaining_balance",
          "outstanding_balance",
          "receipt_number",
          "cashier_id",
          "cashier_name",
          "mechanic_id",
          "mechanic_name",
          "mechanic_commission",
          "payment_status",
          "items_json",
          "customer_name",
          "total_discount",
          "total_tax",
          "total_profit",
          "amount_paid"
        )
        VALUES (
          ${tenantId},
          ${branchId},
          ${shiftId},
          ${payload.referenceId ?? null},
          ${payload.paymentMethod ?? null},
          ${payload.paymentType ?? null},
          ${payload.transactionType ?? 'DIRECT'},
          ${payload.orderType ?? 'WALK_IN'}::"OrderType",
          ${payload.orderStatus ?? 'COMPLETED'}::"OrderStatus",
          ${payload.poStatus ?? null},
          ${payload.dpAmount === undefined || payload.dpAmount === null
            ? new Prisma.Decimal(0)
            : toOptionalDecimal(payload.dpAmount) },
          ${toOptionalDate(payload.pickupDate ?? undefined)},
          ${targetPickupBranchId},
          ${toOptionalDecimal(payload.totalPrice ?? undefined)},
          ${toOptionalDecimal(payload.totalAmount ?? undefined)},
          ${toOptionalDecimal(payload.remainingBalance ?? undefined)},
          ${toOptionalDecimal(payload.outstandingBalance ?? undefined)},
          ${payload.receiptNumber ?? null},
          ${payload.cashierId ?? null},
          ${payload.cashierName ?? null},
          ${payload.mechanicId ?? null},
          ${payload.mechanicName ?? null},
          ${toOptionalDecimal(payload.mechanicCommission ?? undefined)},
          ${payload.paymentStatus ?? null},
          ${JSON.stringify(normalizedItems.map((item) => ({
            productId: item.product_id,
            productName: item.product_name,
            qty: item.qty,
            customPrice: item.custom_price?.toString() ?? null,
            note: item.note,
            isService: item.is_service,
            isCustomItem: item.is_custom_item,
            customName: item.custom_name,
            mechanicId: item.mechanic_id,
            employeeId: item.employee_id,
          })))}::jsonb,
          ${payload.customerName ?? null},
          ${toOptionalBigInt(payload.totalDiscount ?? undefined)},
          ${toOptionalBigInt(payload.totalTax ?? undefined)},
          ${toOptionalBigInt(payload.totalProfit ?? undefined)},
          ${toOptionalDecimal(payload.amountPaid ?? undefined)}
        )
        RETURNING *
      `;

      const sale = saleRows[0];
      const items: SaleItemRow[] = [];

      for (const item of normalizedItems) {
        const itemRows = await tx.$queryRaw<SaleItemRow[]>`
          INSERT INTO "sales_record_items" (
            "tenant_id",
            "sales_record_id",
            "product_id",
            "product_name",
            "qty",
            "is_custom_item",
            "custom_name",
            "custom_price",
            "note",
            "is_service",
            "mechanic_id",
            "employee_id"
          )
          VALUES (
            ${tenantId},
            ${sale.id},
            ${item.product_id},
            ${item.product_name},
            ${item.qty},
            ${item.is_custom_item},
            ${item.custom_name},
            ${item.custom_price},
            ${item.note},
            ${item.is_service},
            ${item.mechanic_id},
            ${item.employee_id}
          )
          RETURNING *
        `;

        const insertedItem = itemRows[0];
        if (insertedItem.custom_price && insertedItem.is_service) {
          console.log(
            `[SalesService.createSale] Service item saved with custom price: ${insertedItem.product_name} = ${insertedItem.custom_price}`
          );
        }
        if (insertedItem.mechanic_id) {
          console.log(
            `[SalesService.createSale] Service item saved with mechanic_id: ${insertedItem.product_name} -> MechanicID=${insertedItem.mechanic_id}`
          );
        }
        items.push(insertedItem);
      }

      return { sale, items };
    });
  }

  static async listPreOrders(filters: PreOrderListFilters) {
    const {
      tenantId,
      branchId,
      requireScopedBranch = false,
      requireAssignedBranch = false,
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
      transaction_type: 'PRE_ORDER',
      ...(branchId !== null ? { branch_id: branchId } : {}),
      ...(branchId === null && requireAssignedBranch ? { branch_id: { not: null } } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.sales_records.findMany({
        where,
        select: {
          id: true,
          tenant_id: true,
          branch_id: true,
          reference_id: true,
          transaction_type: true,
          order_type: true,
          order_status: true,
          po_status: true,
          dp_amount: true,
          pickup_date: true,
          target_pickup_branch_id: true,
          total_amount: true,
          remaining_balance: true,
          payment_status: true,
          customer_name: true,
          cashier_id: true,
          cashier_name: true,
          created_at: true,
          updated_at: true,
          branch: {
            select: {
              id: true,
              name: true,
            },
          },
          target_pickup_branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        skip,
        take: safeLimit,
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

  static async getPreOrderSummary(filters: PreOrderSummaryFilters) {
    const {
      tenantId,
      branchId,
      requireScopedBranch = false,
      requireAssignedBranch = false,
    } = filters;

    if (requireScopedBranch && branchId === null) {
      throw new AppError(
        'Akses ditolak: konteks cabang wajib tersedia untuk akun ini',
        403,
      );
    }

    const activeWhere: Prisma.sales_recordsWhereInput = {
      tenant_id: tenantId,
      transaction_type: 'PRE_ORDER',
      ...(branchId !== null ? { branch_id: branchId } : {}),
      ...(branchId === null && requireAssignedBranch ? { branch_id: { not: null } } : {}),
      OR: [
        { po_status: null },
        {
          po_status: {
            notIn: ['COMPLETED', 'CANCELLED', 'VOID', 'PICKED_UP'],
          },
        },
      ],
    };

    const aggregate = await prisma.sales_records.aggregate({
      where: activeWhere,
      _count: {
        _all: true,
      },
      _sum: {
        dp_amount: true,
      },
    });

    return {
      totalActivePreOrders: aggregate._count._all,
      totalDpHeld: aggregate._sum.dp_amount ?? new Prisma.Decimal(0),
    };
  }

  private static async ensureBranchOwnership(
    tenantId: string,
    branchId: bigint | null | undefined,
    fieldName: 'branchId' | 'targetPickupBranchId',
  ) {
    if (branchId === undefined || branchId === null) {
      return;
    }

    const rows = await prisma.$queryRaw<BranchLookupRow[]>`
      SELECT "id"
      FROM "branches"
      WHERE "id" = ${branchId} AND "tenant_id" = ${tenantId}
      LIMIT 1
    `;

    const branch = rows[0];

    if (!branch) {
      throw new AppError(`${fieldName} tidak ditemukan untuk tenant aktif`, 400);
    }
  }

  private static async ensureShiftOwnership(
    tenantId: string,
    shiftId: bigint | null | undefined,
    branchId: bigint | null | undefined,
  ) {
    if (shiftId === undefined || shiftId === null) {
      return;
    }

    const rows = await prisma.$queryRaw<ShiftLookupRow[]>`
      SELECT "id", "branch_id"
      FROM "shifts"
      WHERE "id" = ${shiftId} AND "tenant_id" = ${tenantId}
      LIMIT 1
    `;

    const shift = rows[0];
    if (!shift) {
      throw new AppError('shiftId tidak ditemukan untuk tenant aktif', 400);
    }

    if (branchId !== undefined && branchId !== null && shift.branch_id !== branchId) {
      throw new AppError('shiftId tidak sesuai dengan branchId transaksi', 400);
    }
  }
}