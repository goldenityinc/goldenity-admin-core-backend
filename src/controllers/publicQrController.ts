import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { serializeForJson } from '../utils/serializeForJson';
import { emitToTenant } from '../services/socketServer';

type QrMenuItemRow = {
  id: string;
  name: string;
  category: string | null;
  product_type: string | null;
  price: number | null;
  stock: number | null;
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
    SELECT id, name, category, product_type, price, stock, image_url, is_service
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
        OR COALESCE(stock, 0) > 0
      )
    ORDER BY name ASC
  `;

  const fallbackRows = rows.length > 0
    ? rows
    : await prisma.$queryRaw<QrMenuItemRow[]>`
        SELECT id, name, category, product_type, price, stock, image_url, is_service
        FROM products
        WHERE tenant_id = ${tenantId}
          AND (${branchId ?? null}::bigint IS NULL OR branch_id = ${branchId ?? null})
          AND COALESCE(is_active, true) = true
          AND (
            COALESCE(is_service, false) = true
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
      isAvailable: Number(row.stock || 0) > 0 || row.is_service === true,
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
    const tableRows = await tx.$queryRaw<Array<{ id: bigint; status: string; table_number: string | null }>>`
      SELECT id, status, table_number
      FROM tables
      WHERE id = ${tableId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!tableRows[0]) {
      throw new AppError('Meja tidak ditemukan untuk tenant ini', 404);
    }

    const productIds = items.map((item) => item.productId);
    const products = await tx.$queryRaw<Array<{ id: string; name: string; price: number | null; is_service: boolean | null; stock: number | null }>>`
      SELECT id, name, price, is_service, stock
      FROM products
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(productIds)})
        AND (${branchId ?? null}::bigint IS NULL OR branch_id = ${branchId ?? null})
    `;

    const productMap = new Map(products.map((row) => [row.id, row]));

    let total = 0;
    const normalizedItems = items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(`Produk tidak ditemukan: ${item.productId}`, 404);
      }

      if (!(product.is_service === true) && Number(product.stock ?? 0) < item.qty) {
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
      };
    });

    const referenceId = `qr_${Date.now()}`;
    const receiptNumber = generateReceiptNumber();

    const saleRows = await tx.$queryRaw<Array<{ id: bigint; reference_id: string | null; receipt_number: string | null; total_price: string | null; order_status: string }>>`
      INSERT INTO sales_records (
        tenant_id,
        branch_id,
        table_id,
        reference_id,
        receipt_number,
        payment_method,
        payment_status,
        order_type,
        order_status,
        total_price,
        total_amount,
        customer_name,
        cashier_name,
        items_json,
        amount_paid
      )
      VALUES (
        ${tenantId},
        ${branchId ?? null},
        ${tableId},
        ${referenceId},
        ${receiptNumber},
        ${'Bayar di Kasir'},
        ${'PENDING_PAYMENT'},
        ${'DINE_IN'}::"OrderType",
        ${'PENDING'}::"OrderStatus",
        ${total},
        ${total},
        ${customerName || 'Guest'},
        ${'Online Order'},
        ${JSON.stringify(normalizedItems)}::jsonb,
        ${0}
      )
      RETURNING id, reference_id, receipt_number, cashier_name, total_price, order_status
    `;

    const sale = saleRows[0];
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
          note,
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
          ${item.isService}
        )
      `;

      if (!item.isService) {
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
    };
  });

  const totalItems = items.reduce((sum, item) => sum + item.qty, 0);

  // Keep order-note persistence best-effort and OUTSIDE transaction.
  // In PostgreSQL, a failed statement inside a transaction marks it aborted.
  if (orderNote.isNotEmpty) {
    try {
      await prisma.$queryRaw`
        UPDATE sales_records
        SET special_note = ${orderNote}, updated_at = NOW()
        WHERE id = ${result.id} AND tenant_id = ${tenantId}
      `;
    } catch (_) {
      // Backward compatible when sales_records.special_note is not available yet.
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
    customerName: customerName || 'Guest',
    orderNote,
    special_note: orderNote || null,
    specialNote: orderNote || null,
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
    data: serializeForJson(result),
  });
});
