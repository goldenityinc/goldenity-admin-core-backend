import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import { withTransaction } from '../utils/retryTransaction';
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
  table_id?: bigint | null;
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
  notes: string | null;
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
  notes: string | null;
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

type StockDeductionEntry = {
  productId: string;
  qty: number;
};

type NestedProductLike = {
  id?: unknown;
  product_id?: unknown;
  productId?: unknown;
  name?: unknown;
  product_name?: unknown;
  productName?: unknown;
  qty?: unknown;
  quantity?: unknown;
  price?: unknown;
  unit_price?: unknown;
  unitPrice?: unknown;
  custom_price?: unknown;
  customPrice?: unknown;
  sale_price?: unknown;
  product_price?: unknown;
  productPrice?: unknown;
  harga_jual?: unknown;
  is_service?: unknown;
  isService?: unknown;
  is_stock_tracked?: unknown;
  isStockTracked?: unknown;
  notes?: unknown;
  note?: unknown;
  item_note?: unknown;
  mechanic_id?: unknown;
  mechanicId?: unknown;
  employee_id?: unknown;
  employeeId?: unknown;
};

type CartItemLike = {
  id?: unknown;
  product_id?: unknown;
  productId?: unknown;
  name?: unknown;
  product_name?: unknown;
  productName?: unknown;
  qty?: unknown;
  quantity?: unknown;
  price?: unknown;
  unit_price?: unknown;
  unitPrice?: unknown;
  custom_price?: unknown;
  customPrice?: unknown;
  sale_price?: unknown;
  product_price?: unknown;
  productPrice?: unknown;
  harga_jual?: unknown;
  is_service?: unknown;
  isService?: unknown;
  is_stock_tracked?: unknown;
  isStockTracked?: unknown;
  is_custom_item?: unknown;
  isCustomItem?: unknown;
  custom_name?: unknown;
  customName?: unknown;
  notes?: unknown;
  note?: unknown;
  item_note?: unknown;
  mechanic_id?: unknown;
  mechanicId?: unknown;
  employee_id?: unknown;
  employeeId?: unknown;
  product?: NestedProductLike | null;
  [key: string]: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeProductId(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (s === '0' || s === 'null' || s === 'undefined') return '';
  return s;
}

function normalizeCartItemInPlace(item: CartItemLike) {
  if (!item || typeof item !== 'object') return item;
  const nested = (item.product && typeof item.product === 'object') ? (item.product as NestedProductLike) : null;
  if (nested) {
    const nestedId = normalizeProductId(nested.id ?? nested.product_id ?? nested.productId);
    if (nestedId !== '') {
      const flatId = normalizeProductId(item.product_id ?? item.productId ?? item.id);
      const looksLikeTimestamp =
        (item.id !== null && item.id !== undefined && typeof item.id !== 'boolean') &&
        /^\d+$/.test(String(item.id)) &&
        String(item.id).length >= 13 &&
        Number(item.id) > 1e12;
      if (flatId === '' || flatId !== nestedId || looksLikeTimestamp) {
        if (item.product_id === undefined || String(item.product_id) === String(item.id) || looksLikeTimestamp) {
          (item as unknown as Record<string, unknown>).product_id = nested.id;
        }
        if (item.productId === undefined || String(item.productId) === String(item.id) || looksLikeTimestamp) {
          (item as unknown as Record<string, unknown>).productId = nested.id;
        }
        if (looksLikeTimestamp) {
          (item as unknown as Record<string, unknown>).id = nested.id;
        }
      }
    }
    const preferNestedString = (flat: unknown, nestedVal: unknown) => {
      if ((flat === undefined || flat === null || flat === '') && nestedVal !== undefined && nestedVal !== null && String(nestedVal).trim() !== '') {
        return nestedVal;
      }
      return flat;
    };
    const preferNestedNumber = (flat: unknown, nestedVal: unknown) => {
      const f = toFiniteNumber(flat);
      const n = toFiniteNumber(nestedVal);
      if ((f === null || f <= 0) && n !== null && n > 0) return nestedVal;
      return flat;
    };
    (item as unknown as Record<string, unknown>).name = preferNestedString(item.name, nested.name ?? nested.product_name ?? nested.productName);
    (item as unknown as Record<string, unknown>).product_name = preferNestedString(item.product_name, nested.name ?? nested.product_name ?? nested.productName);
    (item as unknown as Record<string, unknown>).productName = preferNestedString(item.productName, nested.name ?? nested.product_name ?? nested.productName);
    (item as unknown as Record<string, unknown>).qty = preferNestedNumber(item.qty, nested.qty ?? nested.quantity);
    (item as unknown as Record<string, unknown>).quantity = preferNestedNumber(item.quantity, nested.qty ?? nested.quantity);
    (item as unknown as Record<string, unknown>).price = preferNestedNumber(item.price, nested.price ?? nested.product_price ?? nested.productPrice ?? nested.harga_jual);
    (item as unknown as Record<string, unknown>).unit_price = preferNestedNumber(item.unit_price, nested.unit_price ?? nested.unitPrice ?? nested.price);
    (item as unknown as Record<string, unknown>).unitPrice = preferNestedNumber(item.unitPrice, nested.unit_price ?? nested.unitPrice ?? nested.price);
    (item as unknown as Record<string, unknown>).custom_price = preferNestedNumber(item.custom_price, nested.custom_price ?? nested.customPrice);
    (item as unknown as Record<string, unknown>).customPrice = preferNestedNumber(item.customPrice, nested.custom_price ?? nested.customPrice);
    (item as unknown as Record<string, unknown>).harga_jual = preferNestedNumber(item.harga_jual, nested.harga_jual ?? nested.price);
    (item as unknown as Record<string, unknown>).notes = preferNestedString(item.notes ?? item.note ?? item.item_note, nested.notes ?? nested.note);
    (item as unknown as Record<string, unknown>).note = preferNestedString(item.note ?? item.notes ?? item.item_note, nested.note ?? nested.notes);
    (item as unknown as Record<string, unknown>).item_note = preferNestedString(item.item_note ?? item.notes ?? item.note, nested.item_note ?? nested.notes ?? nested.note);
    const boolPreferNestedTrue = (flat: unknown, nestedVal: unknown) => {
      if ((flat === undefined || flat === null || flat === false || flat === 'false' || flat === 0) && (nestedVal === true || nestedVal === 'true' || nestedVal === 1)) {
        return true;
      }
      return flat;
    };
    (item as unknown as Record<string, unknown>).is_service = boolPreferNestedTrue(item.is_service, nested.is_service);
    (item as unknown as Record<string, unknown>).isService = boolPreferNestedTrue(item.isService, nested.isService ?? nested.is_service);
    (item as unknown as Record<string, unknown>).is_stock_tracked = boolPreferNestedTrue(item.is_stock_tracked, nested.is_stock_tracked);
    (item as unknown as Record<string, unknown>).isStockTracked = boolPreferNestedTrue(item.isStockTracked, nested.isStockTracked ?? nested.is_stock_tracked);
    (item as unknown as Record<string, unknown>).mechanic_id = preferNestedString(item.mechanic_id ?? item.mechanicId ?? item.employee_id ?? item.employeeId, nested.mechanic_id ?? nested.mechanicId ?? nested.employee_id ?? nested.employeeId);
    (item as unknown as Record<string, unknown>).mechanicId = preferNestedString(item.mechanicId ?? item.mechanic_id ?? item.employeeId ?? item.employee_id, nested.mechanicId ?? nested.mechanic_id ?? nested.employeeId ?? nested.employee_id);
    (item as unknown as Record<string, unknown>).employee_id = preferNestedString(item.employee_id ?? item.employeeId ?? item.mechanic_id ?? item.mechanicId, nested.employee_id ?? nested.employeeId ?? nested.mechanic_id ?? nested.mechanicId);
    (item as unknown as Record<string, unknown>).employeeId = preferNestedString(item.employeeId ?? item.employee_id ?? item.mechanicId ?? item.mechanic_id, nested.employeeId ?? nested.employee_id ?? nested.mechanicId ?? nested.mechanic_id);
  }
  return item;
}

function normalizeSalePayloadItems(payload: { items: Array<CartItemLike> } | Record<string, unknown>) {
  if (!payload || typeof payload !== 'object') return;
  const arraysToScan: Array<unknown[]> = [];
  const p = payload as Record<string, unknown>;
  const candidates = ['items', 'products', 'cart_items', 'cartItems', 'sales_items', 'order_items', 'detail'];
  for (const key of candidates) {
    const v = p[key];
    if (Array.isArray(v)) arraysToScan.push(v);
  }
  if (Array.isArray(p.records) && (p.records as unknown[])[0] && typeof (p.records as unknown[])[0] === 'object') {
    const firstRec = (p.records as unknown as Record<string, unknown>[])[0];
    for (const key of candidates) {
      const v = firstRec[key];
      if (Array.isArray(v)) arraysToScan.push(v);
    }
  }
  for (const arr of arraysToScan) {
    for (const it of arr) {
      if (it && typeof it === 'object') normalizeCartItemInPlace(it as CartItemLike);
    }
  }
}

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

type ReceiptLookupRow = {
  id: bigint;
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

function normalizeSaleItem(rawItem: SaleItemPayload) {
  const item = (rawItem ?? {}) as unknown as CartItemLike;
  normalizeCartItemInPlace(item);
  const nested = item.product && typeof item.product === 'object' ? item.product : null;

  const nestedObj = (nested as unknown as Record<string, unknown>) || {};
  const itemObj = (item as unknown as Record<string, unknown>) || {};
  const nestedCustomPrice = nested
    ? toOptionalDecimal(
        (nestedObj.custom_price ??
          nestedObj.customPrice ??
          nestedObj.sale_price ??
          null) as string | number | null | undefined,
      )
    : undefined;

  const flatCustomPrice = toOptionalDecimal(
    (itemObj.customPrice ??
      itemObj.custom_price ??
      itemObj.sale_price ??
      null) as string | number | null | undefined,
  );

  const customPriceCandidate = flatCustomPrice !== undefined && flatCustomPrice !== null
    ? flatCustomPrice
    : (nestedCustomPrice ?? undefined);

  const resolvedItemNote =
    (item.notes !== undefined && item.notes !== null && String(item.notes).trim() !== '') ? String(item.notes)
    : (item.note !== undefined && item.note !== null && String(item.note).trim() !== '') ? String(item.note)
    : (item.item_note !== undefined && item.item_note !== null && String(item.item_note).trim() !== '') ? String(item.item_note)
    : (nested?.notes !== undefined && nested.notes !== null && String(nested.notes).trim() !== '') ? String(nested.notes)
    : (nested?.note !== undefined && nested.note !== null && String(nested.note).trim() !== '') ? String(nested.note)
    : null;

  const nestedNameCandidate = nested
    ? (nested.name ?? nested.product_name ?? nested.productName ?? null)
    : null;
  const flatNameCandidate = item.product_name ?? item.productName ?? item.name ?? null;
  const finalProductName =
    (flatNameCandidate !== null && flatNameCandidate !== undefined && String(flatNameCandidate).trim() !== '')
      ? String(flatNameCandidate).trim()
      : (nestedNameCandidate !== null && nestedNameCandidate !== undefined && String(nestedNameCandidate).trim() !== '')
        ? String(nestedNameCandidate).trim()
        : '';

  const normalizedProductName = (item.isCustomItem ?? false)
    ? ((item.customName ?? '').toString().trim() || finalProductName)
    : (finalProductName || null);

  const resolvedCustomPrice =
    customPriceCandidate !== undefined && customPriceCandidate !== null
      ? customPriceCandidate
      : ((item.isCustomItem ?? false) ? new Prisma.Decimal(0) : null);

  const nestedMechanic = nested
    ? (nested.mechanic_id ?? nested.mechanicId ?? nested.employee_id ?? nested.employeeId ?? '')
    : '';
  const flatMechanic = item.mechanicId ?? item.employeeId ?? item.mechanic_id ?? item.employee_id ?? '';
  const mechanicIdRaw =
    (flatMechanic !== '' && flatMechanic !== undefined && flatMechanic !== null)
      ? String(flatMechanic)
      : (nestedMechanic !== '' && nestedMechanic !== undefined && nestedMechanic !== null)
        ? String(nestedMechanic)
        : '';
  const mechanicId = mechanicIdRaw.trim() || null;

  const nestedIsService = nested ? (nested.is_service ?? nested.isService) : undefined;
  const flatIsService = item.isService ?? item.is_service;
  const resolvedIsService =
    (flatIsService !== undefined && flatIsService !== null)
      ? Boolean(flatIsService)
      : (nestedIsService !== undefined && nestedIsService !== null ? Boolean(nestedIsService) : false);

  const nestedIsStockTracked = nested ? (nested.is_stock_tracked ?? nested.isStockTracked) : undefined;
  const flatIsStockTracked = item.isStockTracked ?? item.is_stock_tracked;
  const resolvedIsStockTracked =
    (flatIsStockTracked !== undefined && flatIsStockTracked !== null)
      ? Boolean(flatIsStockTracked)
      : (nestedIsStockTracked !== undefined && nestedIsStockTracked !== null ? Boolean(nestedIsStockTracked) : undefined);

  const isCustomItem = (item.isCustomItem ?? item.is_custom_item ?? false) === true;

  return {
    product_id: isCustomItem
      ? null
      : (normalizeProductId(
          nested?.id ?? nested?.product_id ?? nested?.productId ??
          item.product?.id ??
          item.product_id ?? item.productId ?? item.id,
        ) || null),
    product_name: normalizedProductName,
    qty: toFiniteNumber(
      item.qty ?? item.quantity ?? nested?.qty ?? nested?.quantity ?? 0,
    ) ?? 0,
    custom_price: resolvedCustomPrice,
    notes: resolvedItemNote,
    note: resolvedItemNote,
    item_note: resolvedItemNote,
    is_service: resolvedIsService,
    is_stock_tracked: resolvedIsStockTracked,
    is_custom_item: isCustomItem,
    custom_name: isCustomItem ? normalizedProductName : ((item.customName ?? item.custom_name ?? null) as string | null),
    mechanic_id: mechanicId,
    employee_id: mechanicId,
  };
}

export class SalesService {
  private static shouldGenerateCanonicalReceiptNumber(rawReceipt: string): boolean {
    const normalized = rawReceipt.trim();
    if (normalized.length === 0 || normalized === '-') {
      return true;
    }

    return normalized.toUpperCase().startsWith('MOB-');
  }

  private static buildCanonicalReceiptNumber(): string {
    const now = new Date();
    const yyyymmdd = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(2, '0')}${`${now.getDate()}`.padStart(2, '0')}`;
    const serial = `${Math.floor(Math.random() * 10000)}`.padStart(4, '0');
    return `INV-${yyyymmdd}-${serial}`;
  }

  private static async resolveReceiptNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    incomingReceipt: string | null | undefined,
  ): Promise<string> {
    const normalizedIncoming = (incomingReceipt ?? '').toString().trim();
    if (!this.shouldGenerateCanonicalReceiptNumber(normalizedIncoming)) {
      return normalizedIncoming;
    }

    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = this.buildCanonicalReceiptNumber();
      const existingRows = await tx.$queryRaw<ReceiptLookupRow[]>`
        SELECT "id"
        FROM "sales_records"
        WHERE "tenant_id" = ${tenantId}
          AND "receipt_number" = ${candidate}
        LIMIT 1
      `;
      if (existingRows.length === 0) {
        return candidate;
      }
    }

    throw new AppError('Gagal membuat nomor invoice unik, silakan coba lagi', 500);
  }

  static async createSale(tenantId: string, payload: CreateSaleInput) {
    try {
      normalizeSalePayloadItems(payload as unknown as Record<string, unknown>);
    } catch (_) {}

    try {
      const itemsArr = Array.isArray((payload as unknown as Record<string, unknown>).items)
        ? ((payload as unknown as Record<string, unknown>).items as Array<Record<string, unknown>>)
        : [];
      const firstItems = itemsArr.slice(0, 3).map((it, idx) => {
        try { normalizeCartItemInPlace(it as unknown as CartItemLike); } catch (_) {}
        return {
          index: idx,
          id: it?.id ?? null,
          productId: it?.productId ?? it?.product_id ?? null,
          nestedProductId: (it?.product && typeof it.product === 'object') ? ((it.product as Record<string, unknown>).id ?? null) : null,
          qty: it?.qty ?? it?.quantity ?? null,
          price: it?.price ?? it?.unit_price ?? it?.custom_price ?? ((it?.product && typeof it.product === 'object') ? ((it.product as Record<string, unknown>).price ?? null) : null),
          name: it?.name ?? it?.product_name ?? it?.productName ?? ((it?.product && typeof it.product === 'object') ? ((it.product as Record<string, unknown>).name ?? null) : null),
          isService: it?.isService ?? it?.is_service ?? ((it?.product && typeof it.product === 'object') ? (((it.product as Record<string, unknown>).isService ?? (it.product as Record<string, unknown>).is_service) ?? null) : null),
          isCustomItem: it?.isCustomItem ?? it?.is_custom_item ?? null,
        };
      });
      const summary = {
        tenant: tenantId,
        itemsCount: itemsArr.length,
        branchId: (payload as unknown as Record<string, unknown>).branchId ?? null,
        tableId: (payload as unknown as Record<string, unknown>).tableId ?? null,
        orderType: (payload as unknown as Record<string, unknown>).orderType ?? null,
        totalAmount: (payload as unknown as Record<string, unknown>).totalAmount ?? (payload as unknown as Record<string, unknown>).total_amount ?? (payload as unknown as Record<string, unknown>).totalPrice ?? null,
        receiptNumber: (payload as unknown as Record<string, unknown>).receiptNumber ?? null,
        firstItems,
      };
      console.log(`[SalesService.createSale ENTRY] payload summary=`, JSON.stringify(summary));
      if (itemsArr.length > 0) {
        console.log(`[SalesService.createSale ENTRY] RAW ITEMS JSON=`, JSON.stringify(itemsArr.slice(0, 5)).slice(0, 3500));
      }
    } catch (_) {}

    const branchId = toOptionalBigInt(payload.branchId ?? undefined);
    const tableId = toOptionalBigInt(payload.tableId ?? undefined);
    const shiftId = toOptionalBigInt(payload.shiftId ?? undefined);
    const targetPickupBranchId = toOptionalBigInt(payload.targetPickupBranchId ?? undefined);

    await this.ensureBranchOwnership(tenantId, branchId, 'branchId');
    await this.ensureBranchOwnership(tenantId, targetPickupBranchId, 'targetPickupBranchId');
    await this.ensureShiftOwnership(tenantId, shiftId, branchId);

    if (payload.orderType === 'PRE_ORDER' && !targetPickupBranchId && !branchId) {
      throw new AppError('PRE_ORDER wajib memiliki branchId atau targetPickupBranchId', 400);
    }

    const normalizedItems = payload.items.map(normalizeSaleItem);

    try {
      console.log(`[SalesService.createSale NORMALIZED] ${normalizedItems.length} items:`, JSON.stringify(
        normalizedItems.map((it, i) => ({
          i,
          product_id: it.product_id,
          product_name: it.product_name,
          qty: it.qty,
          custom_price: it.custom_price?.toString(),
          is_service: it.is_service,
          is_custom_item: it.is_custom_item,
          mechanic_id: it.mechanic_id,
        }))
      ).slice(0, 3500));
    } catch (_) {}

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

    return withTransaction(async (tx) => {
      const resolvedReceiptNumber = await this.resolveReceiptNumber(
        tx,
        tenantId,
        payload.receiptNumber,
      );

      const saleRows = await tx.$queryRaw<SaleRow[]>`
        INSERT INTO "sales_records" (
          "tenant_id",
          "branch_id",
          "table_id",
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
          "notes",
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
          ${tableId},
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
          ${resolvedReceiptNumber},
          ${payload.cashierId ?? null},
          ${payload.cashierName ?? null},
          ${payload.notes ?? null},
          ${payload.mechanicId ?? null},
          ${payload.mechanicName ?? null},
          ${toOptionalDecimal(payload.mechanicCommission ?? undefined)},
          ${payload.paymentStatus ?? null},
          ${JSON.stringify(normalizedItems.map((item) => ({
            productId: item.product_id,
            productName: item.product_name,
            qty: item.qty,
            customPrice: item.custom_price?.toString() ?? null,
            notes: item.notes,
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
      const stockDeductionMap = new Map<string, number>();

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
            "notes",
            "note",
            "item_note",
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
            ${item.notes},
            ${item.note},
            ${item.item_note},
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

        const productId = (insertedItem.product_id ?? '').toString().trim();
        const shouldDeductStock =
          productId.length > 0 &&
          !insertedItem.is_service &&
          !insertedItem.is_custom_item &&
          insertedItem.qty > 0;

        if (shouldDeductStock) {
          const previousQty = stockDeductionMap.get(productId) ?? 0;
          stockDeductionMap.set(productId, previousQty + insertedItem.qty);
        }
      }

      const stockUpdates: StockDeductionEntry[] = [];
      if (stockDeductionMap.size > 0) {
        const productIds = Array.from(stockDeductionMap.keys());
        const trackedProductRows = await tx.products.findMany({
          where: {
            tenant_id: tenantId,
            id: { in: productIds },
          },
          select: {
            id: true,
            is_stock_tracked: true,
          },
        });

        const trackedProductIds = new Set(
          trackedProductRows
            .filter((product) => product.is_stock_tracked !== false)
            .map((product) => product.id),
        );

        const deductedTuples: Array<[string, number]> = [];
        for (const [productId, qty] of stockDeductionMap.entries()) {
          if (!trackedProductIds.has(productId)) continue;
          if (!Number.isFinite(qty) || qty <= 0) continue;
          deductedTuples.push([productId, Math.round(qty)]);
        }

        if (deductedTuples.length > 0) {
          const placeholders = deductedTuples.map(
            (_row, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::int)`,
          ).join(', ');
          const values: Array<string | number> = [];
          for (const [productId, qty] of deductedTuples) {
            values.push(productId, qty);
          }
          values.push(tenantId);
          const sql = `
            UPDATE "products" AS p
            SET stock = COALESCE(p.stock, 0) - update_values.qty,
                updated_at = NOW()
            FROM (VALUES ${placeholders}) AS update_values(id, qty)
            WHERE p.id::text = update_values.id
              AND p.tenant_id = $${values.length - 1}::text
              AND COALESCE(p.is_stock_tracked, true) <> false
              AND COALESCE(p.stock, 0) >= update_values.qty
          `;
          const rawUpdate = await (tx as Prisma.TransactionClient).$queryRawUnsafe<Array<{ id: string }>>(
            `${sql} RETURNING p.id::text AS id`,
            ...values,
          );
          const updatedIds = new Set((rawUpdate ?? []).map((row) => row.id));
          for (const [productId, qty] of deductedTuples) {
            if (!updatedIds.has(productId)) {
              throw new AppError(
                `Stok produk tidak mencukupi / tidak ditemukan saat potong stok (id=${productId})`,
                400,
              );
            }
            stockUpdates.push({ productId, qty });
          }
        }
      }

      return { sale, items, stockUpdates };
    }, {
      maxAttempts: 6,
      initialBackoffMs: 75,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeoutMs: 20_000,
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