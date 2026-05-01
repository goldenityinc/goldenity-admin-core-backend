import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';

type OpenShiftParams = {
  tenantId: string;
  branchId: bigint;
  userId: string;
  startingCash: string | number;
};

type CloseShiftParams = {
  tenantId: string;
  branchId: bigint;
  userId: string;
  shiftId: bigint;
  actualCash: string | number;
  actualQris: string | number;
  actualTransfer: string | number;
};

type ExpectedTotalsRow = {
  expected_cash: Prisma.Decimal | null;
  expected_qris: Prisma.Decimal | null;
  expected_transfer: Prisma.Decimal | null;
};

type ShiftRow = {
  id: bigint;
  tenant_id: string;
  branch_id: bigint;
  user_id: string;
  start_time: Date;
  end_time: Date | null;
  status: 'OPEN' | 'CLOSED';
  starting_cash: Prisma.Decimal;
  expected_cash: Prisma.Decimal;
  actual_cash: Prisma.Decimal | null;
  difference_cash: Prisma.Decimal;
  expected_qris: Prisma.Decimal;
  actual_qris: Prisma.Decimal | null;
  difference_qris: Prisma.Decimal;
  expected_transfer: Prisma.Decimal;
  actual_transfer: Prisma.Decimal | null;
  difference_transfer: Prisma.Decimal;
  created_at: Date;
  updated_at: Date;
};

function toDecimal(value: Prisma.Decimal | string | number | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) {
    return new Prisma.Decimal(0);
  }

  return new Prisma.Decimal(value);
}

export class ShiftService {
  static async openShift(params: OpenShiftParams) {
    const { tenantId, branchId, userId, startingCash } = params;

    const existingRows = await prisma.$queryRaw<ShiftRow[]>`
      SELECT *
      FROM "shifts"
      WHERE "tenant_id" = ${tenantId}
        AND "branch_id" = ${branchId}
        AND "user_id" = ${userId}
        AND "status" = 'OPEN'::"ShiftStatus"
      ORDER BY "start_time" DESC
      LIMIT 1
    `;
    const existingOpenShift = existingRows[0];

    if (existingOpenShift) {
      throw new AppError('Masih ada shift OPEN untuk user dan cabang ini', 409);
    }

    const insertedRows = await prisma.$queryRaw<ShiftRow[]>`
      INSERT INTO "shifts" (
        "tenant_id",
        "branch_id",
        "user_id",
        "status",
        "start_time",
        "starting_cash"
      )
      VALUES (
        ${tenantId},
        ${branchId},
        ${userId},
        'OPEN'::"ShiftStatus",
        NOW(),
        ${toDecimal(startingCash)}
      )
      RETURNING *
    `;

    return insertedRows[0];
  }

  static async getActiveShift(tenantId: string, branchId: bigint, userId: string) {
    const rows = await prisma.$queryRaw<ShiftRow[]>`
      SELECT *
      FROM "shifts"
      WHERE "tenant_id" = ${tenantId}
        AND "branch_id" = ${branchId}
        AND "user_id" = ${userId}
        AND "status" = 'OPEN'::"ShiftStatus"
      ORDER BY "start_time" DESC
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  static async closeShift(params: CloseShiftParams) {
    const { tenantId, branchId, userId, shiftId, actualCash, actualQris, actualTransfer } = params;

    return prisma.$transaction(async (tx) => {
      const shiftRows = await tx.$queryRaw<ShiftRow[]>`
        SELECT *
        FROM "shifts"
        WHERE "id" = ${shiftId}
        LIMIT 1
      `;
      const shift = shiftRows[0];

      if (!shift || shift.tenant_id !== tenantId || shift.branch_id !== branchId || shift.user_id !== userId) {
        throw new AppError('Shift tidak ditemukan untuk konteks user/cabang aktif', 404);
      }

      if (shift.status !== 'OPEN') {
        throw new AppError('Shift sudah ditutup', 400);
      }

      const rows = await tx.$queryRaw<ExpectedTotalsRow[]>`
        SELECT
          COALESCE(SUM(CASE WHEN UPPER(COALESCE("payment_method", "payment_type", '')) IN ('CASH', 'TUNAI') THEN COALESCE("amount_paid", "total_amount", "total_price", 0) ELSE 0 END), 0) AS expected_cash,
          COALESCE(SUM(CASE WHEN UPPER(COALESCE("payment_method", "payment_type", '')) IN ('QRIS', 'QRIS', 'QR') THEN COALESCE("amount_paid", "total_amount", "total_price", 0) ELSE 0 END), 0) AS expected_qris,
          COALESCE(SUM(CASE WHEN UPPER(COALESCE("payment_method", "payment_type", '')) IN ('TRANSFER', 'BANK_TRANSFER', 'TRANSFER_BANK') THEN COALESCE("amount_paid", "total_amount", "total_price", 0) ELSE 0 END), 0) AS expected_transfer
        FROM "sales_records"
        WHERE "tenant_id" = ${tenantId}
          AND "shift_id" = ${shiftId}
      `;

      const totals = rows[0];
      const expectedCashFromSales = toDecimal(totals?.expected_cash);
      const expectedQris = toDecimal(totals?.expected_qris);
      const expectedTransfer = toDecimal(totals?.expected_transfer);

      const expectedCash = toDecimal(shift.starting_cash).plus(expectedCashFromSales);
      const actualCashDecimal = toDecimal(actualCash);
      const actualQrisDecimal = toDecimal(actualQris);
      const actualTransferDecimal = toDecimal(actualTransfer);

      const differenceCash = actualCashDecimal.minus(expectedCash);
      const differenceQris = actualQrisDecimal.minus(expectedQris);
      const differenceTransfer = actualTransferDecimal.minus(expectedTransfer);

      const updatedRows = await tx.$queryRaw<ShiftRow[]>`
        UPDATE "shifts"
        SET
          "status" = 'CLOSED'::"ShiftStatus",
          "end_time" = NOW(),
          "expected_cash" = ${expectedCash},
          "actual_cash" = ${actualCashDecimal},
          "difference_cash" = ${differenceCash},
          "expected_qris" = ${expectedQris},
          "actual_qris" = ${actualQrisDecimal},
          "difference_qris" = ${differenceQris},
          "expected_transfer" = ${expectedTransfer},
          "actual_transfer" = ${actualTransferDecimal},
          "difference_transfer" = ${differenceTransfer},
          "updated_at" = NOW()
        WHERE "id" = ${shiftId}
        RETURNING *
      `;

      return updatedRows[0];
    });
  }
}
