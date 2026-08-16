import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { serializeForJson } from '../utils/serializeForJson';
import { AckStatus, SyncStatus, Prisma } from '@prisma/client';
import { emitToBranch, emitToTenant } from '../services/socketServer';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  return tenantId;
}

function parseSalesRecordId(rawId: string): bigint {
  return BigInt(rawId);
}

function validateAckStatus(status: string): AckStatus {
  const validStatuses: AckStatus[] = [
    'PENDING_ACK',
    'POS_ACKNOWLEDGED',
    'POS_PRINTED',
    'FAILED_DELIVERY',
    'TIMEOUT',
  ];
  if (!validStatuses.includes(status as AckStatus)) {
    throw new AppError(
      `Invalid ackStatus. Must be one of: ${validStatuses.join(', ')}`,
      400,
    );
  }
  return status as AckStatus;
}

function mapAckStatusToSyncStatus(ackStatus: AckStatus): SyncStatus {
  const mapping: Record<AckStatus, SyncStatus> = {
    PENDING_ACK: 'PENDING_ACK',
    POS_ACKNOWLEDGED: 'POS_ACKNOWLEDGED',
    POS_PRINTED: 'POS_PRINTED',
    FAILED_DELIVERY: 'FAILED_DELIVERY',
    TIMEOUT: 'FAILED_DELIVERY',
  };
  return mapping[ackStatus];
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧹 PHASE 2: SAFE SUBMISSION ID NORMALIZE (Backward Compat Only).
//
// Bridge SUDAH TIDAK PERNAH mengirim __dup_ / __tblorder_ suffix lagi
// (Phase 1 Dumb Relay). Namun helper normalize ini TETAP ADA sebagai
// safety net apabila masih ada event in-flight dari versi Bridge lama
// saat rolling deploy. Function = idempotent pass-through jika tidak ada suffix.
// ═══════════════════════════════════════════════════════════════════════════
function normalizeSubmissionIdNoDupSuffix(raw: string | null | undefined): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  const legacySuffixesRe = /__(dup|tblorder)_\d+$/;
  while (legacySuffixesRe.test(s)) {
    s = s.replace(legacySuffixesRe, '');
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔥🔥🔥 FIX BE OCCUPIED TABLE LOCK (orderAckController MIRROR RELAY!):
//    SAMA PERSIS pattern di relayOrdersController.ts.
//    Reusable generic helper untuk di acknowledgeOrder function.
// ═══════════════════════════════════════════════════════════════════════════
type OccupiedLockResult = { didOccupy: boolean; payload: Record<string, unknown> | null; };
async function tryOccupyTableIfAvailable({
  tenantId, branchId, tableId, source, syncStatus,
}: { tenantId: string; branchId?: bigint | string | null; tableId: bigint | string; source: string; syncStatus: string; }): Promise<OccupiedLockResult> {
  try {
    const tblWhere: Prisma.tablesWhereUniqueInput = {
      id: typeof tableId === 'bigint' ? tableId : BigInt(String(tableId)),
      tenant_id: tenantId,
    };
    if (branchId !== null && branchId !== undefined && String(branchId).trim() !== '') {
      try { tblWhere.branch_id = typeof branchId === 'bigint' ? branchId : BigInt(String(branchId)); } catch (_) { /* noop */ }
    }
    const current = await prisma.tables.findUnique({
      where: tblWhere,
      select: { id: true, status: true, branch_id: true, tenant_id: true, table_number: true },
    });
    if (!current) return { didOccupy: false, payload: null };
    const curStatus = String(current.status ?? '').toUpperCase();
    if (curStatus !== '' && curStatus !== 'AVAILABLE') {
      return { didOccupy: false, payload: null };
    }
    await prisma.tables.update({
      where: { id: current.id },
      data: { status: 'OCCUPIED', updated_at: new Date() },
    });
    const tblNum = (current as any).table_number ?? (current as any).tableNumber ?? null;
    const payload: Record<string, unknown> = {
      tableId: String(current.id),
      tableName: tblNum ? String(tblNum) : `Meja ${current.id}`,
      status: 'OCCUPIED',
      branchId: current.branch_id ? String(current.branch_id) : null,
      tenantId: String((current as any).tenant_id ?? tenantId),
      source,
      syncStatus,
      timestamp: new Date().toISOString(),
    };
    const tId = String((current as any).tenant_id ?? tenantId);
    const brId = current.branch_id ? String(current.branch_id) : null;
    emitToTenant(tId, 'tables_refresh', payload);
    emitToTenant(tId, 'tables:refresh', payload);
    emitToTenant(tId, 'table_status_changed', payload);
    if (brId) {
      emitToBranch(tId, brId, 'tables_refresh', payload);
      emitToBranch(tId, brId, 'tables:refresh', payload);
      emitToBranch(tId, brId, 'table_status_changed', payload);
    }
    try {
      const ts = new Date().toISOString();
      console.log(`[${ts}] [DEBUG-WEB-ORDER] [BE-OCCUPY-TABLE-ACK-CTRL] source=${source} syncStatus=${syncStatus} tableId=${current.id} name=${payload.tableName} tenantId=${tId} branchId=${brId ?? 'null'}`);
    } catch (_) { /* noop */ }
    return { didOccupy: true, payload };
  } catch (tblErr) {
    try {
      const ts = new Date().toISOString();
      console.error(`[${ts}] [DEBUG-WEB-ORDER] [BE-OCCUPY-TABLE-ACK-CTRL-ERR] source=${source} syncStatus=${syncStatus} error=${(tblErr as any)?.message ?? String(tblErr)}`);
    } catch (_) { /* noop */ }
    return { didOccupy: false, payload: null };
  }
}

export const acknowledgeOrder = asyncHandler(async (req: Request, res: Response) => {
  const rawTenantId = req.user?.tenantId;
  const body = (req.body || {}) as Record<string, unknown>;
  const fallbackTenantId = String(body.tenantId ?? body.tenant_id ?? '').trim();
  const tenantId = rawTenantId || fallbackTenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  const { id } = req.params;
  const {
    ackStatus,
    deviceUuid,
    printedAt,
    ackPayload,
    transactionNumber,
    submissionId,
  } = req.body;

  if (!ackStatus) {
    throw new AppError('ackStatus is required', 400);
  }

  const validAckStatus = validateAckStatus(ackStatus);
  let salesRecordId: bigint | null = null;
  try {
    salesRecordId = parseSalesRecordId(id);
  } catch (_) {
    salesRecordId = null;
  }

  // 🔥🔥🔥 FIX BE NORMALIZE DUP SUFFIX: Normalize submissionId dari body + param id!
  const rawSubmissionFromBody = (submissionId ?? '').toString().trim();
  const normalizedSubmissionBody = rawSubmissionFromBody ? normalizeSubmissionIdNoDupSuffix(rawSubmissionFromBody) || rawSubmissionFromBody : '';
  const rawFromId = (id && typeof id === 'string') ? id.trim() : '';
  const normalizedFromId = rawFromId ? normalizeSubmissionIdNoDupSuffix(rawFromId) || rawFromId : '';
  if (rawSubmissionFromBody && normalizedSubmissionBody && rawSubmissionFromBody !== normalizedSubmissionBody) {
    try {
      const ts = new Date().toISOString();
      console.log(`[${ts}] [DEBUG-WEB-ORDER] [BE-NORMALIZE-SUBMISSION] acknowledgeOrder body from="${rawSubmissionFromBody}" to normalized="${normalizedSubmissionBody}"`);
    } catch (_) { /* noop */ }
  }

  // 🔴 TOLERANT ROUTE MATCHING: if :id bukan numeric BigInt (submissionId / receiptNumber / reference_id) →
  //    RESOLVE sales_record DARI submissionId atau id alias (bukan throw 404 karena parse BigInt gagal).
  const where: any = { tenant_id: tenantId };
  where.OR = [];
  if (salesRecordId !== null) {
    where.OR.push({ id: salesRecordId });
  }
  if (normalizedSubmissionBody) {
    where.OR.push({ submissionId: normalizedSubmissionBody });
  }
  if (normalizedFromId) {
    where.OR.push({ submissionId: normalizedFromId });
    where.OR.push({ reference_id: normalizedFromId });
    where.OR.push({ receipt_number: normalizedFromId });
  }

  // 🔥🔥🔥 FIX BE OCCUPIED TABLE LOCK: TAMBAHKAN table_id di select resolvedSales!
  const salesRecord = salesRecordId !== null
    ? await prisma.sales_records.findUnique({
        where: { id: salesRecordId },
        select: { id: true, tenant_id: true, branch_id: true, table_id: true },
      }).catch(() => null)
    : null;

  const resolvedSales = salesRecord ?? await prisma.sales_records.findFirst({
    where,
    orderBy: { id: 'desc' },
    select: { id: true, tenant_id: true, branch_id: true, table_id: true },
  });

  if (!resolvedSales) {
    throw new AppError('Sales record not found', 404);
  }

  if (resolvedSales.tenant_id && resolvedSales.tenant_id !== tenantId) {
    throw new AppError('Sales record does not belong to this tenant', 403);
  }

  salesRecordId = resolvedSales.id;

  let branchId: bigint | null = null;
  if (resolvedSales.branch_id !== undefined && resolvedSales.branch_id !== null) {
    branchId = BigInt(resolvedSales.branch_id);
  }

  let foundAck;

  const finalSubmissionId = normalizedSubmissionBody || normalizedFromId;
  if (finalSubmissionId) {
    foundAck = await prisma.orderAcknowledgement.findUnique({
      where: { submissionId: finalSubmissionId },
    }).catch(() => null);
  }

  if (!foundAck) {
    foundAck = await prisma.orderAcknowledgement.findFirst({
      where: { salesRecordId },
      orderBy: { createdAt: 'desc' },
    });
  }

  const now = new Date();
  const mappedPrintedAt = printedAt ? new Date(printedAt) : undefined;
  const acknowledgedAt = validAckStatus === 'POS_ACKNOWLEDGED' || validAckStatus === 'POS_PRINTED'
    ? now
    : undefined;
  const finalPrintedAt = validAckStatus === 'POS_PRINTED'
    ? (mappedPrintedAt || now)
    : undefined;

  const upsertData: any = {
    tenantId,
    branchId,
    salesRecordId,
    transactionNumber: transactionNumber ?? undefined,
    submissionId: finalSubmissionId || undefined,
    targetDeviceUuid: deviceUuid ?? undefined,
    ackStatus: validAckStatus,
    acknowledgedAt: acknowledgedAt ?? undefined,
    printedAt: finalPrintedAt ?? undefined,
    ackPayload: ackPayload ?? undefined,
  };

  let ack;

  // ═══════════════════════════════════════════════════════════════════════════
  // 🧹 PHASE 2: IDEMPOTENT PRISMA UPSERT (atomic by DB unique index).
  //
  // Ganti pattern lama (findUnique → if found ? update : create) dengan
  // Prisma upsert ATOMIC. Menjamin PAYLOAD YANG SAMA 2x = safe overwrite
  // bukan error duplicate / row baru.
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    if (finalSubmissionId) {
      // Fast path: submissionId unique constraint → atomic upsert.
      ack = await prisma.orderAcknowledgement.upsert({
        where: { submissionId: finalSubmissionId },
        create: { ...upsertData, retriesCount: 0, firstQueuedAt: now },
        update: {
          ...upsertData,
          retriesCount: { increment: 1 },
        },
      });
    } else if (foundAck) {
      // Fallback: tidak ada unique where tapi ada existing by salesRecordId.
      ack = await prisma.orderAcknowledgement.update({
        where: { id: (foundAck as any).id },
        data: { ...upsertData, retriesCount: { increment: 1 } },
      });
    } else {
      ack = await prisma.orderAcknowledgement.create({
        data: { ...upsertData, retriesCount: 0, firstQueuedAt: now },
      });
    }
  } catch (upsertErr: any) {
    // Safety fallback 1x pakai legacy pattern jika Prisma upsert transient gagal.
    try {
      if (foundAck) {
        ack = await prisma.orderAcknowledgement.update({
          where: { id: (foundAck as any).id },
          data: { ...upsertData, retriesCount: { increment: 1 } },
        });
      } else {
        ack = await prisma.orderAcknowledgement.create({
          data: { ...upsertData, retriesCount: 0, firstQueuedAt: now },
        });
      }
    } catch {
      throw upsertErr;
    }
  }

  const syncStatus = mapAckStatusToSyncStatus(validAckStatus);

  await prisma.sales_records.update({
    where: { id: salesRecordId },
    data: {
      syncStatus,
      targetDeviceUuid: deviceUuid ?? undefined,
      submissionId: finalSubmissionId || undefined,
    },
  });

  // 🔥🔥🔥 FIX BE OCCUPIED TABLE LOCK: Safety net TABLE OCCUPIED di acknowledgeOrder!
  //    Ini = LAST LINE OF DEFENSE: jika patchRelayOrderSyncStatus DAN
  //    postRelayOrderAckBySubmission GAGAL occupy (exception / route tidak kena),
  //    function acknowledgeOrder (canonical route) INI YANG AKAN MEMASTIKAN MEJA = MERAH!
  let tableRefreshPayload: Record<string, unknown> | null = null;
  if ((validAckStatus === 'POS_ACKNOWLEDGED' || validAckStatus === 'POS_PRINTED') && (resolvedSales as any).table_id) {
    try {
      const occ = await tryOccupyTableIfAvailable({
        tenantId,
        branchId: (resolvedSales as any).branch_id ?? branchId ?? null,
        tableId: (resolvedSales as any).table_id,
        source: 'admin_core.acknowledge_order_canonical',
        syncStatus,
      });
      if (occ.didOccupy && occ.payload) tableRefreshPayload = occ.payload;
    } catch (_occErr) {
      try {
        const ts = new Date().toISOString();
        console.error(`[${ts}] [DEBUG-WEB-ORDER] [BE-OCCUPY-ACK-CANONICAL-ERR] id=${String(salesRecordId)} error=${(_occErr as any)?.message ?? String(_occErr)}`);
      } catch (_) { /* noop */ }
    }
  }

  return res.status(200).json({
    success: true,
    ok: true,
    message: 'Order acknowledgement recorded successfully',
    ackId: ack.id.toString(),
    tableOccupied: !!tableRefreshPayload,
    tableRefresh: tableRefreshPayload,
    data: serializeForJson(ack),
  });
});

export const getOrderAckStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const { id } = req.params;
  const submissionId = req.body?.submissionId ?? req.query?.submissionId;

  if (!id) {
    throw new AppError('Order ID is required', 400);
  }

  let salesRecordId: bigint | null = null;
  try {
    salesRecordId = parseSalesRecordId(id);
  } catch (_) {
    salesRecordId = null;
  }

  const where: any = { tenant_id: tenantId };
  where.OR = [];
  if (salesRecordId !== null) {
    where.OR.push({ id: salesRecordId });
  }
  if (submissionId && typeof submissionId === 'string' && submissionId.trim()) {
    where.OR.push({ submissionId: String(submissionId).trim() });
  }
  if (id && typeof id === 'string' && id.trim()) {
    where.OR.push({ submissionId: id.trim() });
    where.OR.push({ reference_id: id.trim() });
    where.OR.push({ receipt_number: id.trim() });
  }

  const salesRecordUnique = salesRecordId !== null
    ? await prisma.sales_records.findUnique({
        where: { id: salesRecordId },
        select: { id: true, tenant_id: true },
      }).catch(() => null)
    : null;

  const resolvedSales = salesRecordUnique ?? await prisma.sales_records.findFirst({
    where,
    orderBy: { id: 'desc' },
    select: { id: true, tenant_id: true },
  });

  if (!resolvedSales) {
    throw new AppError('Sales record not found', 404);
  }

  if (resolvedSales.tenant_id && resolvedSales.tenant_id !== tenantId) {
    throw new AppError('Sales record does not belong to this tenant', 403);
  }

  salesRecordId = resolvedSales.id;

  let ack = await prisma.orderAcknowledgement.findUnique({
    where: { submissionId: (submissionId ?? '').toString().trim() || id.trim() },
  }).catch(() => null);

  if (!ack) {
    ack = await prisma.orderAcknowledgement.findFirst({
      where: { salesRecordId },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!ack) {
    return res.status(200).json({
      success: true,
      ackStatus: null,
      retriesCount: 0,
      acknowledgedAt: null,
      printedAt: null,
      lastError: null,
      message: 'No acknowledgement record found for this order',
    });
  }

  return res.status(200).json({
    success: true,
    ackStatus: ack.ackStatus,
    retriesCount: ack.retriesCount,
    acknowledgedAt: ack.acknowledgedAt ? ack.acknowledgedAt.toISOString() : null,
    printedAt: ack.printedAt ? ack.printedAt.toISOString() : null,
    lastError: ack.lastError,
  });
});
