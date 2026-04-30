import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type { CreateSaleInput } from '../validations/salesValidation';

type SaleItemPayload = CreateSaleInput['items'][number];

type BranchLookupRow = {
  id: bigint;
};

type SaleRow = {
  id: bigint;
  tenant_id: string | null;
  branch_id: bigint | null;
  reference_id: string | null;
  payment_method: string | null;
  payment_type: string | null;
  order_type: string;
  order_status: string;
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
  is_custom_item: boolean;
  custom_name: string | null;
  custom_price: Prisma.Decimal | null;
  note: string | null;
  is_service: boolean;
  created_at: Date | null;
  updated_at: Date | null;
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

  return {
    product_id: item.isCustomItem ? null : item.productId ?? null,
    product_name: normalizedProductName,
    qty: item.qty,
    custom_price: item.isCustomItem ? customPrice ?? new Prisma.Decimal(0) : customPrice,
    note: item.note ?? null,
    is_service: item.isService ?? false,
    is_custom_item: item.isCustomItem ?? false,
    custom_name: item.isCustomItem ? normalizedProductName : item.customName ?? null,
  };
}

export class SalesService {
  static async createSale(tenantId: string, payload: CreateSaleInput) {
    const branchId = toOptionalBigInt(payload.branchId ?? undefined);
    const targetPickupBranchId = toOptionalBigInt(payload.targetPickupBranchId ?? undefined);

    await this.ensureBranchOwnership(tenantId, branchId, 'branchId');
    await this.ensureBranchOwnership(tenantId, targetPickupBranchId, 'targetPickupBranchId');

    if (payload.orderType === 'PRE_ORDER' && !targetPickupBranchId && !branchId) {
      throw new AppError('PRE_ORDER wajib memiliki branchId atau targetPickupBranchId', 400);
    }

    const normalizedItems = payload.items.map(normalizeSaleItem);

    return prisma.$transaction(async (tx) => {
      const saleRows = await tx.$queryRaw<SaleRow[]>`
        INSERT INTO "sales_records" (
          "tenant_id",
          "branch_id",
          "reference_id",
          "payment_method",
          "payment_type",
          "order_type",
          "order_status",
          "pickup_date",
          "target_pickup_branch_id",
          "total_price",
          "total_amount",
          "remaining_balance",
          "outstanding_balance",
          "receipt_number",
          "cashier_id",
          "cashier_name",
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
          ${payload.referenceId ?? null},
          ${payload.paymentMethod ?? null},
          ${payload.paymentType ?? null},
          ${payload.orderType ?? 'WALK_IN'}::"OrderType",
          ${payload.orderStatus ?? 'COMPLETED'}::"OrderStatus",
          ${toOptionalDate(payload.pickupDate ?? undefined)},
          ${targetPickupBranchId},
          ${toOptionalDecimal(payload.totalPrice ?? undefined)},
          ${toOptionalDecimal(payload.totalAmount ?? undefined)},
          ${toOptionalDecimal(payload.remainingBalance ?? undefined)},
          ${toOptionalDecimal(payload.outstandingBalance ?? undefined)},
          ${payload.receiptNumber ?? null},
          ${payload.cashierId ?? null},
          ${payload.cashierName ?? null},
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
            "is_service"
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
            ${item.is_service}
          )
          RETURNING *
        `;

        items.push(itemRows[0]);
      }

      return { sale, items };
    });
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
}