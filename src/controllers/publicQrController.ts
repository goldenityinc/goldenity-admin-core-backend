import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { serializeForJson } from '../utils/serializeForJson';
import { emitToTenant, emitToBranch } from '../services/socketServer';
import { AccountingPostingService } from '../services/accountingPostingService';
import { AuditLogService } from '../services/auditLogService';
import { ObjectStorageService } from '../services/objectStorageService';
import { withTransaction } from '../utils/retryTransaction';

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
  note?: string | null;
  customPrice?: number;
};

type QrOrderBatchItem = QrOrderItemInput & {
  batch_sequence: number;
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
    const nested = (row.product && typeof row.product === 'object')
      ? (row.product as Record<string, unknown>)
      : null;

    const normalizeId = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
    const looksLikeTimestamp = (v: unknown) => {
      if (v === null || v === undefined) return false;
      const s = String(v);
      return /^\d+$/.test(s) && s.length >= 13 && Number(v) > 1e12;
    };

    const nestedId = normalizeId(nested?.id ?? nested?.product_id ?? nested?.productId);
    const flatId = normalizeId(row.productId ?? row.product_id);
    const rowId = normalizeId(row.id);

    let productId = '';
    if (nestedId !== '' && (flatId === '' || flatId === rowId || looksLikeTimestamp(flatId))) {
      productId = nestedId;
    } else if (flatId !== '' && !looksLikeTimestamp(flatId)) {
      productId = flatId;
    } else if (nestedId !== '') {
      productId = nestedId;
    } else if (rowId !== '' && !looksLikeTimestamp(rowId)) {
      productId = rowId;
    }

    if (!productId) {
      throw new AppError(`items[${index}].productId wajib diisi`, 400);
    }

    const qtyRaw =
      row.qty ?? row.quantity ?? nested?.qty ?? nested?.quantity ?? 0;
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new AppError(`items[${index}].qty harus angka bulat > 0`, 400);
    }

    const customPriceRaw =
      row.customPrice ?? row.custom_price ??
      nested?.customPrice ?? nested?.custom_price ??
      row.price ?? row.unit_price ?? row.unitPrice ?? row.sale_price ?? row.product_price ?? row.productPrice ?? row.harga_jual ??
      nested?.price ?? nested?.unit_price ?? nested?.unitPrice ?? nested?.sale_price ?? nested?.product_price ?? nested?.productPrice ?? nested?.harga_jual;
    const customPrice = customPriceRaw === undefined || customPriceRaw === null || customPriceRaw === ''
      ? undefined
      : Number(customPriceRaw);

    if (customPrice !== undefined && (!Number.isFinite(customPrice) || customPrice < 0)) {
      throw new AppError(`items[${index}].customPrice tidak valid`, 400);
    }

    const noteRaw =
      row.note ?? row.notes ?? row.item_note ??
      nested?.note ?? nested?.notes ?? nested?.item_note ??
      '';

    return {
      productId,
      qty,
      note: (noteRaw ?? '').toString().trim() || undefined,
      customPrice,
    };
  });
}

function resolveCurrentBatchSequence(itemsJson: Prisma.JsonValue | null): number {
  if (!Array.isArray(itemsJson)) {
    return 0;
  }

  let highest = 0;

  for (const rawItem of itemsJson) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      continue;
    }

    const item = rawItem as Record<string, unknown>;
    const batchCandidate =
      item.batch_sequence ??
      item.batchSequence ??
      item.batch ??
      item.sequence;
    const parsedBatch =
      typeof batchCandidate === 'number'
        ? batchCandidate
        : Number((batchCandidate ?? '').toString().trim());

    if (Number.isFinite(parsedBatch) && parsedBatch > highest) {
      highest = parsedBatch;
    }
  }

  return highest;
}

function stampBatchSequence(
  items: QrOrderItemInput[],
  batchSequence: number,
): QrOrderBatchItem[] {
  return items.map((item) => ({
    ...item,
    batch_sequence: batchSequence,
  }));
}

function generateReceiptNumber(): string {
  const now = new Date();
  const yyyymmdd = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(2, '0')}${`${now.getDate()}`.padStart(2, '0')}`;
  const serial = `${now.getTime() % 10000}`.padStart(4, '0');
  return `INV-${yyyymmdd}-${serial}`;
}

function parseSalesRecordId(value: unknown): bigint {
  const text = (value ?? '').toString().trim();
  if (!/^\d+$/.test(text)) {
    throw new AppError('order_id tidak valid (harus numeric id dari sales_records)', 400);
  }
  return BigInt(text);
}

function inferImageExtension(mimeType: string): string | null {
  const mt = mimeType.trim().toLowerCase();
  if (mt === 'image/png') return 'png';
  if (mt === 'image/jpeg' || mt === 'image/jpg') return 'jpg';
  if (mt === 'image/webp') return 'webp';
  if (mt === 'image/svg+xml') return 'svg';
  if (mt === 'application/pdf') return 'pdf';
  return null;
}

function getFirstUploadedFile(req: Request, fieldName: string): Express.Multer.File | undefined {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (files?.[fieldName]?.[0]) return files[fieldName][0];
  if ((req as any).file && (req as any).file.fieldname === fieldName) {
    return (req as any).file as Express.Multer.File;
  }
  if (Array.isArray((req as any).files)) {
    const asArr = (req as any).files as Express.Multer.File[];
    return asArr.find((f) => f.fieldname === fieldName) ?? asArr[0];
  }
  return undefined;
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
  const orderType = 'DINE_IN';
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
  const idempotencyKey = (
    req.header('Idempotency-Key') ??
    req.header('idempotency-key') ??
    req.body.idempotencyKey ??
    req.body.idempotency_key ??
    ''
  ).toString().trim() || null;
  const referenceId = idempotencyKey
    ? `qr_${idempotencyKey}`
    : (req.body.referenceId ?? req.body.reference_id ?? '').toString().trim() ||
      `qr_${Date.now()}_${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const result = await withTransaction(async (tx) => {
    type ExistingSaleRow = {
      id: bigint;
      branch_id: bigint | null;
      table_id: bigint | null;
      order_type: string | null;
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

    if (idempotencyKey && idempotencyKey.length > 0) {
      const idempotentRows = await tx.$queryRaw<Array<ExistingSaleRow & { created_at: Date | null }>>`
        SELECT
          id,
          branch_id,
          table_id,
          order_type::text AS order_type,
          reference_id,
          receipt_number,
          cashier_name,
          total_price,
          total_amount,
          order_status::text AS order_status,
          payment_status,
          payment_proof_url,
          items_json,
          created_at
        FROM sales_records
        WHERE tenant_id = ${tenantId}
          AND reference_id = ${referenceId}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `;
      const existingByIdem = idempotentRows[0];
      if (existingByIdem) {
        const tableRowsForIdem = await tx.$queryRaw<Array<{ table_number: string | null }>>`
          SELECT table_number
          FROM tables
          WHERE id = ${tableId} AND tenant_id = ${tenantId}
          LIMIT 1
        `;
        return {
          id: existingByIdem.id,
          reference_id: existingByIdem.reference_id,
          receipt_number: existingByIdem.receipt_number,
          cashier_name: existingByIdem.cashier_name,
          total_price: existingByIdem.total_price,
          total_amount: existingByIdem.total_amount,
          order_status: existingByIdem.order_status,
          payment_status: existingByIdem.payment_status ?? 'PENDING_PAYMENT',
          payment_proof_url: existingByIdem.payment_proof_url ?? paymentProofUrl ?? null,
          table_id: tableId,
          table_number: tableRowsForIdem[0]?.table_number ?? null,
          order_type: (existingByIdem.order_type ?? orderType) as string,
          special_note: orderNote || null,
          orderAction: 'IDEMPOTENT_REPLAY' as const,
          current_batch_sequence: Math.max(resolveCurrentBatchSequence(existingByIdem.items_json), 1),
          new_items: [],
          items_json: Array.isArray(existingByIdem.items_json) ? existingByIdem.items_json : [],
          // 🔴 FIX 1: Pass branch_id keluar dari IDEMPOTENT_REPLAY transaction block juga
          branch_id: (existingByIdem.branch_id ?? branchId ?? null),
          effectiveBranchId: (existingByIdem.branch_id ?? branchId ?? null),
        };
      }
    }

    const paymentMethodLabelForExistingSale =
      paymentMethod === PAYMENT_METHOD_QRIS ? 'QRIS' : 'Bayar di Kasir';
    // Lock current active/unpaid order for this table to avoid race conditions under heavy load.
    // 🔴 CRITICAL FIX (PAYMENT CONTAMINATION — QRIS vs CASHIER):
    //    HANYA append ke existing sale JIKA payment_method SAMA PERSIS.
    //    Jika user buat Order 1 = CASHIER, lalu Order 2 = QRIS — JANGAN DIGABUNG,
    //    harus INSERT sales_record BARU, supaya saat QRIS di-mark PAID, Order 1 CASHIER TIDAK ikut ter-mark PAID.
    //    Tambahan: reference_id HARUS sama atau null (idempotency), dan created_at < 30 menit lalu.
    const existingSaleRows = await tx.$queryRaw<ExistingSaleRow[]>`
      SELECT
        id,
        branch_id,
        table_id,
        order_type::text AS order_type,
        reference_id,
        receipt_number,
        cashier_name,
        total_price,
        total_amount,
        order_status::text AS order_status,
        payment_status,
        payment_proof_url,
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
        AND (
          UPPER(COALESCE(payment_method, '')) = UPPER(${paymentMethodLabelForExistingSale})
          OR COALESCE(payment_method, '') = ''
        )
        AND (
          (reference_id IS NOT NULL AND ${referenceId} IS NOT NULL AND reference_id = ${referenceId})
          OR reference_id IS NULL
          OR COALESCE(reference_id, '') = ''
        )
        AND created_at >= NOW() - INTERVAL '30 minutes'
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
      FOR NO KEY UPDATE
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

    const receiptNumber = generateReceiptNumber();
    // ORDER FIRST, PAY LATER: always create as PENDING_PAYMENT / PENDING.
    // Payment proof and PAID status are ONLY set later via PUT /qr-orders/:id/payment.
    const paymentMethodLabel =
      paymentMethod === PAYMENT_METHOD_QRIS ? 'QRIS' : 'Bayar di Kasir';
    const paymentStatus = 'PENDING_PAYMENT';
    const orderStatus = 'PENDING';
    const amountPaid = 0;

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
    const specialNoteColumnRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sales_records'
          AND column_name = 'special_note'
      ) AS "exists"
    `;
    const supportsSpecialNote = specialNoteColumnRows[0]?.exists === true;

    let sale: UpsertedSaleRow | null = null;
    let orderAction: 'NEW_ORDER' | 'APPENDED_TO_EXISTING' = 'NEW_ORDER';
    const currentBatchSequence = existingSale
      ? Math.max(resolveCurrentBatchSequence(existingSale.items_json), 1) + 1
      : 1;
    const batchItems = stampBatchSequence(normalizedItems, currentBatchSequence);
    const existingItemsJson = Array.isArray(existingSale?.items_json)
      ? (existingSale.items_json as QrOrderBatchItem[])
      : [];
    const mergedItemsJson = [...existingItemsJson, ...batchItems];

    if (existingSale) {
      orderAction = 'APPENDED_TO_EXISTING';

      const existingTotal = Number(existingSale.total_price ?? existingSale.total_amount ?? 0);
      const mergedTotal = existingTotal + total;
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
          ${supportsPaymentProofUrl ? Prisma.sql`, NULL::text AS payment_proof_url` : Prisma.empty}
          ${supportsSpecialNote && orderNote.length > 0 ? Prisma.sql`, special_note` : Prisma.empty}
        )
        VALUES (
          ${tenantId},
          ${effectiveBranchId ?? null},
          ${tableId},
          ${referenceId},
          ${receiptNumber},
          ${paymentMethodLabel},
          ${paymentStatus},
          ${orderNote || null},
          ${orderType}::"OrderType",
          ${orderStatus}::"OrderStatus",
          ${total},
          ${total},
          ${customerName || 'Guest'},
          ${'Online Order'},
          ${JSON.stringify(batchItems)}::jsonb,
          ${amountPaid}
          ${supportsPaymentProofUrl ? Prisma.sql`, NULL::text` : Prisma.empty}
          ${supportsSpecialNote && orderNote.length > 0 ? Prisma.sql`, ${orderNote}` : Prisma.empty}
        )
        RETURNING id, reference_id, receipt_number, cashier_name, total_price, total_amount, order_status::text AS order_status, payment_status
        ${supportsPaymentProofUrl ? Prisma.sql`, payment_proof_url` : Prisma.sql`, NULL::text AS payment_proof_url`}
      `;

      sale = saleRows[0] ?? null;
    }

    if (!sale) {
      throw new AppError('Gagal membuat pesanan QR', 500);
    }

    const stockDeductionTuples: Array<[string, number]> = [];
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
          is_service,
          batch_sequence
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
          ${item.isService},
          ${currentBatchSequence}
        )
      `;

      if (!item.isService && item.isStockTracked) {
        const qty = Number(item.qty ?? 0);
        if (Number.isFinite(qty) && qty > 0) {
          stockDeductionTuples.push([item.productId, qty]);
        }
      }
    }

    if (stockDeductionTuples.length > 0) {
      const aggregated = new Map<string, number>();
      for (const [productId, qty] of stockDeductionTuples) {
        aggregated.set(productId, (aggregated.get(productId) ?? 0) + qty);
      }
      const tuplesList = Array.from(aggregated.entries());
      if (tuplesList.length > 0) {
        const placeholders = tuplesList.map(
          (_row, index) => `($${index * 2 + 1}::text, $${index * 2 + 2}::int)`,
        ).join(', ');
        const values: Array<string | number> = [];
        for (const [productId, qty] of tuplesList) {
          values.push(productId, qty);
        }
        values.push(tenantId);
        const sql = `
          UPDATE products AS p
          SET stock = COALESCE(p.stock, 0) - update_values.qty,
              updated_at = NOW()
          FROM (VALUES ${placeholders}) AS update_values(id, qty)
          WHERE p.id = update_values.id::uuid
            AND p.tenant_id = $${values.length - 1}::text
            AND COALESCE(p.is_stock_tracked, true) <> false
            AND COALESCE(p.stock, 0) >= update_values.qty
        `;
        const rawUpdate = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `${sql} RETURNING p.id::text AS id`,
          ...values,
        );
        const updatedIds = new Set((rawUpdate ?? []).map((row) => row.id));
        for (const [productId, qty] of tuplesList) {
          if (!updatedIds.has(productId)) {
            throw new AppError(
              `Stok produk tidak mencukupi saat proses pesanan QR (id=${productId}, butuh=${qty})`,
              400,
            );
          }
        }
      }
    }

    await tx.$queryRaw`
      UPDATE tables
      SET status = ${'OCCUPIED'}::"TableStatus", updated_at = NOW()
      WHERE id = ${tableId} AND tenant_id = ${tenantId}
    `;

    return {
      ...sale,
      table_id: tableId,
      table_number: tableRows[0]?.table_number ?? null,
      order_type: orderType,
      special_note: orderNote || null,
      payment_proof_url: null,
      payment_method_label: paymentMethodLabel,
      orderAction,
      current_batch_sequence: currentBatchSequence,
      new_items: batchItems,
      items_json: mergedItemsJson,
      // 🔴 FIX 1: Pass branch_id keluar dari transaction block supaya socket emit
      //    di LUAR transaction dapat branch room untuk broadcast ke semua device branch.
      branch_id: effectiveBranchId,
      effectiveBranchId,
    };
  }, {
    maxAttempts: 6,
    initialBackoffMs: 80,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeoutMs: 18_000,
  });

  const totalItems = items.reduce((sum, item) => sum + item.qty, 0);

  if (orderNote.length > 0 && result.orderAction === 'NEW_ORDER') {
    // Already persisted inline when column is available; nothing to do here.
  } else if (orderNote.length > 0) {
    try {
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
    } catch (error) {
      const errMeta = {
        stage: 'POST_TX_SPECIAL_NOTE',
        tenantId,
        orderId: String(result.id ?? ''),
        referenceId: String(result.reference_id ?? ''),
        receiptNumber: String(result.receipt_number ?? ''),
        orderAction: result.orderAction,
        message: error instanceof Error ? error.message : String(error ?? ''),
        stack: error instanceof Error ? error.stack : undefined,
      };
      console.warn(
        '[publicQrController.createQrOrder] optional special_note post-update failed (non-fatal)',
        JSON.stringify(errMeta),
      );
    }
  }

  // NOTE: Order First, Pay Later.
  // Accounting posting + audit log for PAID orders run ONLY when payment proof is uploaded
  // via PUT /qr-orders/:id/payment. Not at create time (always PENDING_PAYMENT).

  const tableLabel = (result.table_number ?? '').toString().trim();
  const finalPaymentStatus = 'PENDING_PAYMENT';
  const resultAsAny = result as Record<string, unknown>;
  const defaultPaymentMethodLabel = 'Bayar di Kasir';
  const finalPaymentMethod = (
    typeof resultAsAny.payment_method_label === 'string' &&
    resultAsAny.payment_method_label.length > 0
      ? resultAsAny.payment_method_label
      : defaultPaymentMethodLabel
  ).toString();
  const finalOrderStatus = (result.order_status ?? 'PENDING').toString().trim() || 'PENDING';
  const finalPaymentProofUrl = null;
  const finalOrderType = (result.order_type ?? orderType).toString();

  // 🔴 FIX 1 scope fix: effectiveBranchId di-define DI DALAM withTransaction block,
  //    jadi akses lewat result.effectiveBranchId yang sudah di-inject saat return.
  const resultEffectiveBranchId =
    (result as Record<string, unknown>).effectiveBranchId !== undefined
      ? (result as Record<string, unknown>).effectiveBranchId as bigint | string | null
      : ((result as Record<string, unknown>).branch_id as bigint | string | null ?? null);

  const qrOrderSocketPayload: Record<string, unknown> = {
    tenantId,
    branchId: (resultEffectiveBranchId !== null && resultEffectiveBranchId !== undefined) ? String(resultEffectiveBranchId) : null,
    branch_id: (resultEffectiveBranchId !== null && resultEffectiveBranchId !== undefined) ? String(resultEffectiveBranchId) : null,
    orderId: result.id,
    referenceId: result.reference_id,
    receiptNumber: result.receipt_number,
    tableId,
    table_id: tableId.toString(),
    tableName: tableLabel || tableId.toString(),
    table_number: tableLabel || tableId.toString(),
    orderType: finalOrderType,
    order_type: finalOrderType,
    orderStatus: finalOrderStatus,
    paymentStatus: finalPaymentStatus,
    paymentMethod: finalPaymentMethod,
    paymentProofUrl: finalPaymentProofUrl,
    payment_proof_url: finalPaymentProofUrl,
    customerName: customerName || 'Guest',
    orderNote,
    special_note: orderNote || null,
    specialNote: orderNote || null,
    orderAction: result.orderAction,
    order_action: result.orderAction,
    totalItems,
    grandTotal: Number(result.total_price ?? 0),
    current_batch_sequence: result.current_batch_sequence,
    new_items: result.new_items,
    items: result.new_items,
    items_json: result.items_json,
    batch_sequence: result.current_batch_sequence,
    created_at: new Date().toISOString(),
    isAutoPaid: false,
  };
  // 🔴 FIX 1 (Socket broadcast):
  //    DUA-DUANYA di-emit! Tenant room (UI admin di browser PC) DAPET,
  //    Branch room (Tablet Printer POS Flutter yang sudah join_branch) JUGA DAPET.
  //    Tidak lagi "hanya satu device PC yang dapat notif" — SEMUA device di branch terkait
  //    (Tablet + Printer + Kasir) menerima incoming_qr_order secara bersamaan.
  emitToTenant(tenantId, 'incoming_qr_order', qrOrderSocketPayload);
  emitToBranch(tenantId, (result.effectiveBranchId ?? result.branch_id ?? null), 'incoming_qr_order', qrOrderSocketPayload);
  emitToTenant(tenantId, 'new_web_order', qrOrderSocketPayload);
  emitToBranch(tenantId, (result.effectiveBranchId ?? result.branch_id ?? null), 'new_web_order', qrOrderSocketPayload);

  return res.status(201).json({
    success: true,
    orderAction: result.orderAction,
    idempotentReplay: result.orderAction === 'IDEMPOTENT_REPLAY',
    data: serializeForJson({
      ...result,
      orderAction: result.orderAction,
      idempotentReplay: result.orderAction === 'IDEMPOTENT_REPLAY',
      current_batch_sequence: result.current_batch_sequence,
      new_items: result.new_items,
      finalPaymentStatus,
      finalOrderStatus,
      finalPaymentMethod,
    }),
  });
});

export const uploadQrOrderPayment = asyncHandler(async (req: Request, res: Response) => {
  const orderId = parseSalesRecordId(req.params.id ?? req.params.orderId);
  const tenantId = parseTenantId(
    req.body.tenantId ??
      req.body.tenant_id ??
      req.query.tenantId ??
      req.query.tenant_id ??
      req.header('X-Tenant-Id'),
  );

  const file = getFirstUploadedFile(req, 'payment_proof') ??
    getFirstUploadedFile(req, 'file') ??
    getFirstUploadedFile(req, 'proof') ??
    getFirstUploadedFile(req, 'paymentProof') ??
    undefined;
  const rawUrl = (
    req.body.payment_proof_url ??
    req.body.paymentProofUrl ??
    req.body.proof_url ??
    req.body.proofUrl ??
    ''
  ).toString().trim();

  const paymentMethodRaw = normalizePaymentMethod(
    req.body.paymentMethod ?? req.body.payment_method,
  );
  const paymentMethodLabel =
    paymentMethodRaw === PAYMENT_METHOD_QRIS ? 'QRIS' : 'Bayar di Kasir';

  if (!file && !rawUrl) {
    throw new AppError(
      'Bukti pembayaran wajib dikirim (file upload di field `payment_proof` atau URL di field `payment_proof_url`',
      400,
    );
  }

  let finalProofUrl = rawUrl || '';
  let storageKey: string | null = null;

  if (file) {
    const mt = (file.mimetype ?? '').toLowerCase();
    if (!file.mimetype || (!mt.startsWith('image/') && mt !== 'application/pdf')) {
      throw new AppError('File bukti pembayaran harus gambar (png/jpg/webp) atau PDF', 400);
    }
    const ext = inferImageExtension(file.mimetype) ?? (mt === 'application/pdf' ? 'pdf' : null);
    if (!ext) {
      throw new AppError('Format file tidak didukung (png/jpg/webp/pdf)', 400);
    }
    const key = `tenants/${tenantId}/qr-payments/${orderId.toString()}-${Date.now()}.${ext}`;
    try {
      const uploaded = await ObjectStorageService.putPublicObject({
        key,
        body: file.buffer,
        contentType: file.mimetype,
      });
      finalProofUrl = uploaded.url;
      storageKey = uploaded.key;
    } catch (storageErr) {
      const errMeta = {
        stage: 'PROOF_UPLOAD_STORAGE_SAVE',
        tenantId,
        orderId: orderId.toString(),
        fileName: file.originalname ?? file.fieldname,
        sizeBytes: file.size ?? 0,
        message: storageErr instanceof Error ? storageErr.message : String(storageErr ?? ''),
        stack: storageErr instanceof Error ? storageErr.stack : undefined,
      };
      console.error(
        '[publicQrController.uploadQrOrderPayment] failed uploading payment proof to object storage',
        JSON.stringify(errMeta),
      );
      throw new AppError('Gagal upload bukti pembayaran ke storage', 502);
    }
  }

  type OrderForProofUpdateRow = {
    id: bigint;
    tenant_id: string;
    branch_id: bigint | null;
    table_id: bigint | null;
    order_type: string | null;
    reference_id: string | null;
    receipt_number: string | null;
    customer_name: string | null;
    total_price: string | null;
    total_amount: string | null;
    order_status: string;
    payment_status: string | null;
    payment_method: string | null;
    payment_proof_url: string | null;
    notes: string | null;
    amount_paid: string | null;
    items_json: Prisma.JsonValue | null;
    updated_at: Date | null;
  };

  const result = await withTransaction(async (tx) => {
    const proofColRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sales_records' AND column_name = 'payment_proof_url'
      ) AS "exists"
    `;
    const supportsProof = proofColRows[0]?.exists === true;

    const lockedRows = await tx.$queryRaw<OrderForProofUpdateRow[]>`
      SELECT
        id,
        tenant_id,
        branch_id,
        table_id,
        order_type::text AS order_type,
        reference_id,
        receipt_number,
        customer_name,
        total_price,
        total_amount,
        order_status::text AS order_status,
        payment_status,
        payment_method,
        ${supportsProof ? Prisma.sql`payment_proof_url` : Prisma.sql`NULL::text AS payment_proof_url`},
        notes,
        amount_paid,
        items_json,
        updated_at
      FROM sales_records
      WHERE id = ${orderId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `;
    const orderRow = lockedRows[0];
    if (!orderRow) {
      throw new AppError('Pesanan tidak ditemukan untuk tenant ini', 404);
    }

    const existingPaymentStatusUpper = (orderRow.payment_status ?? '').toString().trim().toUpperCase();
    const existingOrderStatusUpper = (orderRow.order_status ?? '').toString().trim().toUpperCase();
    const alreadyPaid = existingPaymentStatusUpper === 'PAID';

    // Idempotent: already has the same proof URL and status is PAID → replay the same result
    const existingProof = (orderRow.payment_proof_url ?? '').toString().trim();
    if (alreadyPaid && existingProof.length > 0 && existingProof === finalProofUrl) {
      return {
        order: orderRow,
        idempotentReplay: true as const,
        transition: 'NO_CHANGE_IDEMPOTENT_REPLAY' as const,
      };
    }

    const totalAmount = Number(orderRow.total_price ?? orderRow.total_amount ?? 0);
    const newPaymentStatus = 'PAID';
    const newOrderStatus =
      existingOrderStatusUpper === 'COMPLETED' || existingOrderStatusUpper === 'CANCELLED'
        ? orderRow.order_status
        : existingOrderStatusUpper === 'READY_FOR_PICKUP'
          ? orderRow.order_status
          : 'PREPARING';
    const amountPaid = totalAmount;

    const updatedRows = await tx.$queryRaw<OrderForProofUpdateRow[]>`
      UPDATE sales_records
      SET
        payment_status = ${newPaymentStatus},
        order_status = ${newOrderStatus}::"OrderStatus",
        amount_paid = ${amountPaid},
        payment_method = CASE WHEN COALESCE(payment_method, '') = '' THEN ${paymentMethodLabel} ELSE payment_method END,
        ${supportsProof ? Prisma.sql`payment_proof_url = ${finalProofUrl}` : Prisma.empty},
        updated_at = NOW()
      WHERE id = ${orderId} AND tenant_id = ${tenantId}
      RETURNING
        id,
        tenant_id,
        branch_id,
        table_id,
        order_type::text AS order_type,
        reference_id,
        receipt_number,
        customer_name,
        total_price,
        total_amount,
        order_status::text AS order_status,
        payment_status,
        payment_method,
        ${supportsProof ? Prisma.sql`payment_proof_url` : Prisma.sql`NULL::text AS payment_proof_url`},
        notes,
        amount_paid,
        items_json,
        updated_at
    `;
    const updated = updatedRows[0] ?? orderRow;
    return {
      order: updated,
      idempotentReplay: false as const,
      transition: alreadyPaid ? 'STATUS_REPLAY_WITH_NEW_PROOF' as const : 'MARKED_PAID' as const,
    };
  }, {
    maxAttempts: 6,
    initialBackoffMs: 70,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeoutMs: 15_000,
  });

  const order = result.order;
  const finalPaymentStatusForSocket = (order.payment_status ?? 'PAID').toString().trim() || 'PAID';
  const finalOrderStatusForSocket = (order.order_status ?? 'PREPARING').toString().trim() || 'PREPARING';
  const finalProofUrlForSocket = finalProofUrl;
  const finalMethodForSocket = (order.payment_method ?? paymentMethodLabel).toString();
  const totalGrand = Number(order.total_price ?? order.total_amount ?? 0);
  const tableLabel = '';
  const tableIdForSocket = order.table_id;
  // 🔴 FIX 1: Extract branch_id dari order record untuk socket broadcast ke branch room
  const orderBranchId = order.branch_id !== undefined && order.branch_id !== null ? String(order.branch_id) : null;

  const itemsJsonArr = Array.isArray(order.items_json) ? (order.items_json as Array<Record<string, unknown>>) : [];
  const totalQty = itemsJsonArr.reduce<number>((sum, item) => {
    const q = Number((item as Record<string, unknown>).qty);
    return sum + (Number.isFinite(q) && q > 0 ? Number(q) : 0);
  }, 0);

  // Post-commit: accounting + audit (same structure as the removed auto-paid branch in createQrOrder)
  if (!result.idempotentReplay) {
    try {
      await AccountingPostingService.postSalesToJournal(order.id.toString(), tenantId);
    } catch (postingError) {
      const errMeta = {
        stage: 'POST_TX_PROOF_UPLOAD_ACCOUNTING_POST',
        tenantId,
        orderId: order.id.toString(),
        referenceId: String(order.reference_id ?? ''),
        receiptNumber: String(order.receipt_number ?? ''),
        paymentStatus: order.payment_status ?? null,
        orderStatus: order.order_status ?? null,
        message: postingError instanceof Error ? postingError.message : String(postingError ?? ''),
        stack: postingError instanceof Error ? postingError.stack : undefined,
      };
      console.warn(
        '[publicQrController.uploadQrOrderPayment] failed posting accounting journal (non-fatal)',
        JSON.stringify(errMeta),
      );
    }

    const invoiceNumber =
      (order.receipt_number ?? order.reference_id ?? order.id).toString().trim() ||
      order.id.toString();
    try {
      await AuditLogService.createLog({
        tenantId,
        userName: 'System',
        actionType: 'ONLINE_ORDER_PAID_VIA_QR_PROOF',
        details: `[System] Bukti Pembayaran QR Order Telah Diupload & Ditandai Lunas - Invoice: ${invoiceNumber}`,
      });
    } catch (auditError) {
      const errMeta = {
        stage: 'POST_TX_PROOF_UPLOAD_AUDIT_LOG',
        tenantId,
        orderId: order.id.toString(),
        referenceId: String(order.reference_id ?? ''),
        receiptNumber: invoiceNumber,
        message: auditError instanceof Error ? auditError.message : String(auditError ?? ''),
        stack: auditError instanceof Error ? auditError.stack : undefined,
      };
      console.warn(
        '[publicQrController.uploadQrOrderPayment] failed writing audit log (non-fatal)',
        JSON.stringify(errMeta),
      );
    }
  }

  // Dedicated socket event for POS status update
  const statusSocketPayload: Record<string, unknown> = {
    tenantId,
    branchId: orderBranchId,
    branch_id: orderBranchId,
    orderId: order.id,
    referenceId: order.reference_id,
    receiptNumber: order.receipt_number,
    transition: result.transition,
    idempotentReplay: result.idempotentReplay,
    previousPaymentStatus: null,
    orderStatus: finalOrderStatusForSocket,
    paymentStatus: finalPaymentStatusForSocket,
    paymentMethod: finalMethodForSocket,
    paymentProofUrl: finalProofUrlForSocket,
    payment_proof_url: finalProofUrlForSocket,
    storageKey,
    grandTotal: totalGrand,
    totalQty,
    updatedAt: order.updated_at ? new Date(order.updated_at).toISOString() : null,
    created_at: new Date().toISOString(),
  };
  emitToTenant(tenantId, 'qr_order_payment_status_updated', statusSocketPayload);
  emitToBranch(tenantId, orderBranchId, 'qr_order_payment_status_updated', statusSocketPayload);

  // Re-emit incoming_qr_order too so any POS listening to that still refreshes the list
  const reemitPayload: Record<string, unknown> = {
    tenantId,
    branchId: orderBranchId,
    branch_id: orderBranchId,
    orderId: order.id,
    referenceId: order.reference_id,
    receiptNumber: order.receipt_number,
    tableId: tableIdForSocket,
    table_id: tableIdForSocket ? tableIdForSocket.toString() : '',
    tableName: tableLabel,
    table_number: tableLabel,
    orderType: (order.order_type ?? 'DINE_IN').toString(),
    order_type: (order.order_type ?? 'DINE_IN').toString(),
    orderStatus: finalOrderStatusForSocket,
    paymentStatus: finalPaymentStatusForSocket,
    paymentMethod: finalMethodForSocket,
    paymentProofUrl: finalProofUrlForSocket,
    payment_proof_url: finalProofUrlForSocket,
    customerName: (order.customer_name ?? 'Guest').toString(),
    orderNote: (order.notes ?? '').toString(),
    special_note: (order.notes ?? '').toString() || null,
    specialNote: (order.notes ?? '').toString() || null,
    orderAction: result.transition,
    order_action: result.transition,
    totalItems: totalQty,
    grandTotal: totalGrand,
    current_batch_sequence: 1,
    new_items: itemsJsonArr,
    items: itemsJsonArr,
    items_json: itemsJsonArr,
    batch_sequence: 1,
    created_at: new Date().toISOString(),
    isAutoPaid: false,
    idempotentReplay: result.idempotentReplay,
  };
  emitToTenant(tenantId, 'incoming_qr_order', reemitPayload);
  emitToBranch(tenantId, orderBranchId, 'incoming_qr_order', reemitPayload);
  emitToTenant(tenantId, 'new_web_order', reemitPayload);
  emitToBranch(tenantId, orderBranchId, 'new_web_order', reemitPayload);

  return res.status(200).json({
    success: true,
    idempotentReplay: result.idempotentReplay,
    transition: result.transition,
    data: serializeForJson({
      id: order.id,
      tenantId: order.tenant_id,
      referenceId: order.reference_id,
      receiptNumber: order.receipt_number,
      orderType: order.order_type,
      orderStatus: order.order_status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method ?? paymentMethodLabel,
      paymentProofUrl: finalProofUrl,
      storageKey,
      amountPaid: order.amount_paid,
      total_price: order.total_price,
      total_amount: order.total_amount,
      tableId: order.table_id,
      customerName: order.customer_name,
      updatedAt: order.updated_at,
    }),
  });
});
