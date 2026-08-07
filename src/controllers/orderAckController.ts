import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { serializeForJson } from '../utils/serializeForJson';
import { AckStatus, SyncStatus } from '@prisma/client';

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

export const acknowledgeOrder = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
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
  const salesRecordId = parseSalesRecordId(id);

  const salesRecord = await prisma.sales_records.findUnique({
    where: { id: salesRecordId },
    select: {
      id: true,
      tenant_id: true,
      branch_id: true,
    },
  });

  if (!salesRecord) {
    throw new AppError('Sales record not found', 404);
  }

  if (salesRecord.tenant_id && salesRecord.tenant_id !== tenantId) {
    throw new AppError('Sales record does not belong to this tenant', 403);
  }

  let branchId: bigint | null = null;
  if (salesRecord.branch_id !== undefined && salesRecord.branch_id !== null) {
    branchId = BigInt(salesRecord.branch_id);
  }

  let foundAck;

  if (submissionId) {
    foundAck = await prisma.orderAcknowledgement.findUnique({
      where: { submissionId },
    });
  }

  if (!foundAck) {
    foundAck = await prisma.orderAcknowledgement.findFirst({
      where: { salesRecordId },
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
    submissionId: submissionId ?? undefined,
    targetDeviceUuid: deviceUuid ?? undefined,
    ackStatus: validAckStatus,
    acknowledgedAt: acknowledgedAt ?? undefined,
    printedAt: finalPrintedAt ?? undefined,
    ackPayload: ackPayload ?? undefined,
  };

  let ack;

  if (foundAck) {
    ack = await prisma.orderAcknowledgement.update({
      where: { id: foundAck.id },
      data: {
        ...upsertData,
        retriesCount: { increment: 1 },
      },
    });
  } else {
    ack = await prisma.orderAcknowledgement.create({
      data: {
        ...upsertData,
        retriesCount: 0,
        firstQueuedAt: now,
      },
    });
  }

  const syncStatus = mapAckStatusToSyncStatus(validAckStatus);

  await prisma.sales_records.update({
    where: { id: salesRecordId },
    data: {
      syncStatus,
      targetDeviceUuid: deviceUuid ?? undefined,
      submissionId: submissionId ?? undefined,
    },
  });

  return res.status(200).json({
    success: true,
    ok: true,
    message: 'Order acknowledgement recorded successfully',
    ackId: ack.id.toString(),
    data: serializeForJson(ack),
  });
});

export const getOrderAckStatus = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const { id } = req.params;

  if (!id) {
    throw new AppError('Order ID is required', 400);
  }

  const salesRecordId = parseSalesRecordId(id);

  const salesRecord = await prisma.sales_records.findUnique({
    where: { id: salesRecordId },
    select: {
      id: true,
      tenant_id: true,
    },
  });

  if (!salesRecord) {
    throw new AppError('Sales record not found', 404);
  }

  if (salesRecord.tenant_id && salesRecord.tenant_id !== tenantId) {
    throw new AppError('Sales record does not belong to this tenant', 403);
  }

  let ack = await prisma.orderAcknowledgement.findFirst({
    where: { salesRecordId },
    orderBy: { createdAt: 'desc' },
  });

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
