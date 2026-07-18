import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { serializeForJson } from '../utils/serializeForJson';
import { emitToTenant } from '../services/socketServer';
import { AccountingPostingService } from '../services/accountingPostingService';
import { AuditLogService } from '../services/auditLogService';

const PAYMENT_METHOD_QRIS = 'QRIS';
const PAYMENT_METHOD_CASHIER = 'CASHIER';

function normalizePaymentMethod(value: unknown): 'QRIS' | 'CASHIER' {
  const normalized = (value ?? '').toString().trim().toUpperCase();
  if (normalized === PAYMENT_METHOD_QRIS) {
    return PAYMENT_METHOD_QRIS;
  }
  return PAYMENT_METHOD_CASHIER;
}

type QrMenuItemRow = {
  id: string;
  name: string;
  category: string | null;
  product_type: string | null;
  price: number | null;
  stock: number | null;
  is_stock_tracked?: boolean | null;
  image_url: string | null;
  is_service?: boolean | null;
};

type QrOrderItemInput = {
  productId: string;
  qty: number;
  note?: string;
  customPrice?: number;
};

function parseOptionalBranchId(value: unknown): bigint | undefined {
  const text = (value ?? '').toString().trim();
  if (!text) {
    return undefined;
  }
  if (!/^\d+$/.test(text)) {
    throw new AppError('branch_id tidak valid', 400);
  }
  return BigInt(text);
}

function parseTenantId(value: unknown): string {
  const tenantId = (value ?? '').toString().trim();
  if (!tenantId) {
    throw new AppError('tenantId wajib diisi', 400);
  }
  return tenantId;
}

function parseTableId(value: unknown): bigint {
  const text = (value ?? '').toString().trim();
  if (!/^\d+$/.test(text)) {
    throw new AppError('table_id tidak valid', 400);
  }
  return BigInt(text);
}

function parseQrOrderItems(value: unknown): QrOrderItemInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError('items wajib diisi minimal 1 item', 400);
  }

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new AppError(`items[${index}] tidak valid`, 400);
    }

    const row = raw as Record<string, unknown>;
    const productId = (row.productId ?? row.product_id ?? '').toString().trim();
    if (!productId) {
      throw new AppError(`items[${index}].productId wajib diisi`, 400);
    }

    const qty = Number(row.qty ?? row.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new AppError(`items[${index}].qty harus angka bulat > 0`, 400);
    }

    const customPriceRaw = row.customPrice ?? row.custom_price;
    const customPrice = customPriceRaw === undefined || customPriceRaw === null || customPriceRaw === ''
      ? undefined
      : Number(customPriceRaw);

    if (customPrice !== undefined && (!Number.isFinite(customPrice) || customPrice < 0)) {
      throw new AppError(`items[${index}].customPrice tidak valid`, 400);
    }

    return {
      productId,
      qty,
      note: (row.note ?? '').toString().trim() || undefined,
      customPrice,
    };
  });
}

function generateReceiptNumber(): string {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(2, '0')}${`${now.getDate()}`.padStart(2, '0')}`;
  const serial = `${now.getTime() % 10000}`.padStart(4, '0');
  return `INV-${yyyymmdd}-${serial}`;
}

export const getQrMenu = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = parseTenantId(req.params.tenantId);
  const branchId = parseOptionalBranchId(req.query.branchId ?? req.query.branch_id);
  const branchNameFromQuery = (req.query.branchName ?? req.query.branch_name ?? '')
    .toString()
    .trim();

  const rows = await prisma.$queryRaw<QrMenuItemRow[]>`
    SELECT id, name, category, product_type, price, stock, is_stock_tracked, image_url, is_service
    FROM products
    WHERE tenant_id = ${tenantId}
      AND (${branchId ?? null}::bigint IS NULL OR branch_id = ${branchId ?? null})
      AND COALESCE(is_active, true) = true
      AND (
        UPPER(COALESCE(product_type, '')) IN ('FOOD', 'BEVERAGE', 'FNB', 'F&B', 'MENU')
        OR LOWER(COALESCE(category, '')) IN ('food', 'beverage', 'fnb', 'f&b', 'menu')
      )
      AND (
        COALESCE(is_service, false) = true
        OR COALESCE(is_stock_tracked, true) = false
        OR COALESCE(stock, 0) > 0
      )
    ORDER BY name ASC
  `;

  const fallbackRows = rows.length > 0
    ? rows
    : await prisma.$queryRaw<QrMenuItemRow[]>`
      SELECT id, name, category, product_type, price, stock, is_stock_tracked, image_url, is_service
        FROM products
        WHERE tenant_id = ${tenantId}
          AND (${branchId ?? null}::bigint IS NULL OR branch_id = ${branchId ?? null})
          AND COALESCE(is_active, true) = true
          AND (
            COALESCE(is_service, false) = true
            OR COALESCE(is_stock_tracked, true) = false
            OR COALESCE(stock, 0) > 0
          )
        ORDER BY name ASC
      `;

  const [tenantMeta, branchMeta, storeSetting] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    }),
    branchId
      ? prisma.branch.findFirst({
          where: { tenantId, id: branchId },
          select: { id: true, name: true, branchCode: true },
        })
      : Promise.resolve(null),
    prisma.store_settings.findFirst({
      where: {
        tenant_id: tenantId,
        key: { in: ['store_name', 'nama_toko', 'name'] },
      },
      orderBy: [
        { updated_at: 'desc' },
        { created_at: 'desc' },
      ],
    }),
  ]);

  const categoriesMap = new Map<string, { id: string; name: string; sortOrder: number }>();
  const products = fallbackRows.map((row) => {
    const categoryName = (row.category || 'Menu').toString().trim() || 'Menu';
    const categoryId = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!categoriesMap.has(categoryId)) {
      categoriesMap.set(categoryId, {
        id: categoryId,
        name: categoryName,
        sortOrder: categoriesMap.size,
      });
    }

    return {
      id: row.id,
      name: row.name,
      categoryId,
      categoryName,
      price: Number(row.price || 0),
      isAvailable:
        row.is_service === true ||
        row.is_stock_tracked === false ||
        Number(row.stock || 0) > 0,
      stock: Number(row.stock || 0),
      imageUrl: row.image_url || null,
      sortOrder: 0,
    };
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson({
      tenant: {
        id: tenantId,
        name: (storeSetting?.value || tenantMeta?.name || '').toString().trim() || null,
        slug: tenantMeta?.slug || null,
      },
      branch: {
        id: branchId ?? null,
        name: branchMeta?.name || branchNameFromQuery || null,
        code: branchMeta?.branchCode || null,
      },
      categories: Array.from(categoriesMap.values()),
      products,
      items: products,
    }),
  });
});

export const createQrOrder = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = parseTenantId(req.body.tenantId ?? req.body.tenant_id);
  const tableId = parseTableId(req.body.tableId ?? req.body.table_id);
  const branchId = parseOptionalBranchId(req.body.branchId ?? req.body.branch_id);
  const items = parseQrOrderItems(req.body.items);
  const paymentMethod = normalizePaymentMethod(
    req.body.paymentMethod ?? req.body.payment_method,
  );
  const paymentProofUrl = (
    req.body.payment_proof_url ??
    req.body.paymentProofUrl ??
    req.body.proof_url ??
    req.body.proofUrl ??
    ''
  ).toString().trim() || null;
  const customerName = (req.body.customerName ?? req.body.customer_name ?? 'Guest').toString().trim();
  const orderNote = (
    req.body.orderNote ??
    req.body.order_note ??
    req.body.special_note ??
    req.body.specialNote ??
    req.body.customerNote ??
    req.body.customer_note ??
    req.body.note ??
    req.body.notes ??
    ''
  ).toString().trim();

  const result = await prisma.$transaction(async (tx) => {
    type ExistingSaleRow = {
      id: bigint;
      branch_id: bigint | null;
      reference_id: string | null;
      receipt_number: string | null;
      cashier_name: string | null;
      total_price: string | null;
      total_amount: string | null;
      order_status: string;
      payment_status: string | null;
      payment_proof_url: string | null;
      items_json: Prisma.JsonValue | null;
    };

    type UpsertedSaleRow = {
      id: bigint;
      reference_id: string | null;
      receipt_number: string | null;
      cashier_name: string | null;
      total_price: string | null;
      total_amount: string | null;
      order_status: string;
      payment_status: string;
      payment_proof_url: string | null;
    };

    const tableRows = await tx.$queryRaw<Array<{ id: bigint; status: string; table_number: string | null }>>`
      SELECT id, status, table_number
      FROM tables
      WHERE id = ${tableId} AND tenant_id = ${tenantId}
      LIMIT 1
      FOR UPDATE
    `;

    if (!tableRows[0]) {
      throw new AppError('Meja tidak ditemukan untuk tenant ini', 404);
    }

    // Lock current active/unpaid order for this table to avoid race conditions under heavy load.
    const existingSaleRows = await tx.$queryRaw<ExistingSaleRow[]>`
      SELECT
        id,
        branch_id,
        reference_id,
        receipt_number,
        cashier_name,
        total_price,
        total_amount,
        order_status::text AS order_status,
        payment_status,
        items_json
      FROM sales_records
      WHERE tenant_id = ${tenantId}
        AND table_id = ${tableId}
        AND (
          UPPER(COALESCE(payment_status, '')) IN ('UNPAID', 'PENDING_PAYMENT')
          OR UPPER(COALESCE(order_status::text, '')) IN (
            'PENDING',
            'PENDING_PAYMENT',
            'PREPARING',
            'READY_FOR_PICKUP',
            'ACTIVE',
            'UNPAID'
          )
        )
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    `;
    const existingSale = existingSaleRows[0] ?? null;
    const effectiveBranchId = existingSale?.branch_id ?? branchId ?? null;

    const productIds = items.map((item) => item.productId);
    const products = await tx.$queryRaw<Array<{ id: string; name: string; price: number | null; is_service: boolean | null; is_stock_tracked: boolean | null; stock: number | null }>>`
      SELECT id, name, price, is_service, is_stock_tracked, stock
      FROM products
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(productIds)})
        AND (${effectiveBranchId}::bigint IS NULL OR branch_id = ${effectiveBranchId})
    `;

    const productMap = new Map(products.map((row) => [row.id, row]));

    let total = 0;
    const normalizedItems = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(`Produk tidak ditemukan: ${item.productId}`, 404);
      }

      const isStockTracked = product.is_stock_tracked !== false;
      if (!(product.is_service === true) && isStockTracked && Number(product.stock ?? 0) < item.qty) {
        throw new AppError(`Stok tidak cukup untuk produk ${product.name}`, 400);
      }

      const unitPrice = item.customPrice ?? Number(product.price ?? 0);
      total += unitPrice * item.qty;

      return {
        productId: item.productId,
        productName: product.name,
        qty: item.qty,
        customPrice: unitPrice,
        note: item.note ?? null,
        isService: product.is_service === true,
        isStockTracked,
      };
    });

    const referenceId = `qr_${Date.now()}`;
    const receiptNumber = generateReceiptNumber();
    const isAutoPaidQris =
      paymentMethod === PAYMENT_METHOD_QRIS &&
      paymentProofUrl !== null &&
      paymentProofUrl.trim().length > 0;
    const paymentMethodLabel =
      paymentMethod === PAYMENT_METHOD_QRIS ? 'QRIS' : 'Bayar di Kasir';
    const paymentStatus = isAutoPaidQris ? 'PAID' : 'PENDING_PAYMENT';
    const orderStatus = isAutoPaidQris ? 'PREPARING' : 'PENDING';
    const amountPaid = isAutoPaidQris ? total : 0;

    const paymentProofColumnRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sales_records'
          AND column_name = 'payment_proof_url'
      ) AS "exists"
    `;
    const supportsPaymentProofUrl = paymentProofColumnRows[0]?.exists === true;

    let sale: UpsertedSaleRow | null = null;
    let orderAction: 'NEW_ORDER' | 'APPENDED_TO_EXISTING' = 'NEW_ORDER';

    if (existingSale) {
      orderAction = 'APPENDED_TO_EXISTING';

      const existingTotal = Number(existingSale.total_price ?? existingSale.total_amount ?? 0);
      const mergedTotal = existingTotal + total;
      const existingItemsJson = Array.isArray(existingSale.items_json)
        ? existingSale.items_json
        : [];
      const mergedItemsJson = [
        ...existingItemsJson,
        ...normalizedItems,
      ];

      const updatedSaleRows = await tx.$queryRaw<UpsertedSaleRow[]>`
        UPDATE sales_records
        SET
          total_price = ${mergedTotal},
          total_amount = ${mergedTotal},
          items_json = ${JSON.stringify(mergedItemsJson)}::jsonb,
          updated_at = NOW()
        WHERE id = ${existingSale.id}
          AND tenant_id = ${tenantId}
        RETURNING id, reference_id, receipt_number, cashier_name, total_price, total_amount, order_status::text AS order_status, payment_status
        ${supportsPaymentProofUrl ? Prisma.sql`, payment_proof_url` : Prisma.sql`, NULL::text AS payment_proof_url`}
      `;

      sale = updatedSaleRows[0] ?? null;
    } else {
      const saleRows = await tx.$queryRaw<UpsertedSaleRow[]>`
        INSERT INTO sales_records (
          tenant_id,
          branch_id,
          table_id,
          reference_id,
          receipt_number,
          payment_method,
          payment_status,
          notes,
          order_type,
          order_status,
          total_price,
          total_amount,
          customer_name,
          cashier_name,
          items_json,
          amount_paid
          ${supportsPaymentProofUrl ? Prisma.sql`, payment_proof_url` : Prisma.empty}
        )
        VALUES (
          ${tenantId},
          ${branchId ?? null},
          ${tableId},
          ${referenceId},
          ${receiptNumber},
          ${paymentMethodLabel},
          ${paymentStatus},
          ${orderNote || null},
          ${'DINE_IN'}::"OrderType",
          ${orderStatus}::"OrderStatus",
          ${total},
          ${total},
          ${customerName || 'Guest'},
          ${'Online Order'},
          ${JSON.stringify(normalizedItems)}::jsonb,
          ${amountPaid}
          ${supportsPaymentProofUrl ? Prisma.sql`, ${paymentProofUrl}` : Prisma.empty}
        )
        RETURNING id, reference_id, receipt_number, cashier_name, total_price, total_amount, order_status::text AS order_status, payment_status
        ${supportsPaymentProofUrl ? Prisma.sql`, payment_proof_url` : Prisma.sql`, NULL::text AS payment_proof_url`}
      `;

      sale = saleRows[0] ?? null;
    }

    if (!sale) {
      throw new AppError('Gagal membuat pesanan QR', 500);
    }

    for (const item of normalizedItems) {
      await tx.$queryRaw`
        INSERT INTO sales_record_items (
          tenant_id,
          sales_record_id,
          product_id,
          product_name,
          qty,
          custom_price,
          notes,
          note,
          item_note,
          is_service
        )
        VALUES (
          ${tenantId},
          ${sale.id},
          ${item.productId},
          ${item.productName},
          ${item.qty},
          ${item.customPrice},
          ${item.note},
          ${item.note},
          ${item.note},
          ${item.isService}
        )
      `;

      if (!item.isService && item.isStockTracked) {
        await tx.$queryRaw`
          UPDATE products
          SET stock = COALESCE(stock, 0) - ${item.qty}, updated_at = NOW()
          WHERE id = ${item.productId} AND tenant_id = ${tenantId}
        `;
      }
    }

    await tx.$queryRaw`
      UPDATE tables
      SET status = ${'OCCUPIED'}::"TableStatus", updated_at = NOW()
      WHERE id = ${tableId} AND tenant_id = ${tenantId}
    `;

    return {
      ...sale,
      table_number: tableRows[0]?.table_number ?? null,
      special_note: orderNote || null,
      payment_proof_url: sale.payment_proof_url ?? paymentProofUrl ?? null,
      orderAction,
    };
  });

  const totalItems = items.reduce((sum, item) => sum + item.qty, 0);

  // Keep order-note persistence best-effort and OUTSIDE transaction.
  // In PostgreSQL, a failed statement inside a transaction marks it aborted.
  if (orderNote.length > 0) {
    try {
      if (result.orderAction === 'APPENDED_TO_EXISTING') {
        await prisma.$queryRaw`
          UPDATE sales_records
          SET
            special_note = CASE
              WHEN COALESCE(special_note, '') = '' THEN ${orderNote}
              ELSE special_note || E'\n---\n' || ${orderNote}
            END,
            updated_at = NOW()
          WHERE id = ${result.id} AND tenant_id = ${tenantId}
        `;
      } else {
        await prisma.$queryRaw`
          UPDATE sales_records
          SET special_note = ${orderNote}, updated_at = NOW()
          WHERE id = ${result.id} AND tenant_id = ${tenantId}
        `;
      }
    } catch (_) {
      // Backward compatible when sales_records.special_note is not available yet.
    }
  }

  const isPaidOrder =
    (result.payment_status ?? '').toString().trim().toUpperCase() === 'PAID';
  if (isPaidOrder) {
    try {
      await AccountingPostingService.postSalesToJournal(
        result.id.toString(),
        tenantId,
      );
    } catch (postingError) {
      console.warn(
        '[publicQrController.createQrOrder] failed posting accounting journal:',
        postingError instanceof Error ? postingError.message : postingError,
      );
    }

    const invoiceNumber =
      (result.receipt_number ?? result.reference_id ?? result.id)
        .toString()
        .trim() || result.id.toString();
    try {
      await AuditLogService.createLog({
        tenantId,
        userName: 'System',
        actionType: 'ONLINE_ORDER_AUTO_PAID',
        details:
          `[System] Pesanan Online Berhasil Dibuat & Dibayar Otomatis via QRIS - Invoice: ${invoiceNumber}`,
      });
    } catch (auditError) {
      console.warn(
        '[publicQrController.createQrOrder] failed writing audit log:',
        auditError instanceof Error ? auditError.message : auditError,
      );
    }
  }

  const tableLabel = (result.table_number ?? '').toString().trim();
  emitToTenant(tenantId, 'incoming_qr_order', {
    tenantId,
    orderId: result.id,
    referenceId: result.reference_id,
    receiptNumber: result.receipt_number,
    tableId,
    tableName: tableLabel || tableId.toString(),
    orderType: 'DINE_IN',
    orderStatus: result.order_status,
    paymentStatus: 'PENDING_PAYMENT',
    paymentMethod: 'Bayar di Kasir',
    paymentProofUrl: (result.payment_proof_url ?? '').toString().trim() || null,
    payment_proof_url: (result.payment_proof_url ?? '').toString().trim() || null,
    customerName: customerName || 'Guest',
    orderNote,
    special_note: orderNote || null,
    specialNote: orderNote || null,
    orderAction: result.orderAction,
    order_action: result.orderAction,
    totalItems,
    grandTotal: Number(result.total_price ?? 0),
    items: items.map((item) => ({
      product_id: item.productId,
      qty: item.qty,
      custom_price: item.customPrice ?? 0,
      note: item.note ?? '',
      item_note: item.note ?? '',
      notes: item.note ?? '',
    })),
    items_json: items.map((item) => ({
      product_id: item.productId,
      qty: item.qty,
      custom_price: item.customPrice ?? 0,
      note: item.note ?? '',
      item_note: item.note ?? '',
      notes: item.note ?? '',
    })),
    created_at: new Date().toISOString(),
  });

  return res.status(201).json({
    success: true,
    orderAction: result.orderAction,
    data: serializeForJson({
      ...result,
      orderAction: result.orderAction,
    }),
  });
});
