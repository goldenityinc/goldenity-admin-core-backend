import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import { clientIdToNumericBigInt, clientIdToNumber } from '../utils/clientIdMapping';
import type { UpsertClientPaymentCellInput } from '../validations/clientPaymentValidation';

type MatrixRecord = {
  id: bigint;
  tenant_id: string | null;
  client_id: bigint;
  product_id: string;
  period_month: number;
  period_year: number;
  status: any;
  amount: Prisma.Decimal;
  receipt_images: string[];
  notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
};

function parseReceiptImages(dbValue: string | null): string[] {
  if (!dbValue || !dbValue.trim()) return [];
  try {
    const parsed = JSON.parse(dbValue);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

function serializeReceiptImages(images: string[]): string {
  return JSON.stringify(images || []);
}

function mapRecord(rec: any): MatrixRecord {
  return {
    ...rec,
    receipt_images: parseReceiptImages(rec.receipt_images),
  };
}

export class ClientPaymentService {
  static async getMatrix(tenantId: string, year: number, productId?: string) {
    const where: Prisma.client_payment_recordsWhereInput = {
      tenant_id: tenantId,
      period_year: year,
      ...(productId ? { product_id: productId } : {}),
    };

    const records = await prisma.client_payment_records.findMany({
      where,
      orderBy: [
        { client_id: 'asc' },
        { product_id: 'asc' },
        { period_month: 'asc' },
      ],
    });

    return records.map(mapRecord);
  }

  static async getCellById(tenantId: string, id: bigint) {
    const record = await prisma.client_payment_records.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
    });

    if (!record) return null;
    return mapRecord(record);
  }

  static async upsertCell(tenantId: string, payload: UpsertClientPaymentCellInput) {
    const clientIdBig = clientIdToNumericBigInt(payload.clientId);
    const clientIdNum = clientIdToNumber(payload.clientId);
    const productId = payload.productId.toString();
    const periodMonth = payload.periodMonth;
    const periodYear = payload.periodYear;
    const originalClientId = (payload.clientId ?? '').toString().trim() || clientIdNum.toString();

    if (periodMonth < 1 || periodMonth > 12) {
      throw new AppError('periodMonth harus di antara 1 sampai 12', 400);
    }
    if (payload.amount < 0) {
      throw new AppError('amount tidak boleh negatif', 400);
    }

    const existingRecord = await prisma.client_payment_records.findFirst({
      where: {
        tenant_id: tenantId,
        client_id: clientIdBig,
        product_id: productId,
        period_month: periodMonth,
        period_year: periodYear,
      },
    });

    let result;

    if (existingRecord) {
      result = await prisma.client_payment_records.update({
        where: { id: existingRecord.id },
        data: {
          status: payload.status,
          amount: new Prisma.Decimal(payload.amount),
          receipt_images: serializeReceiptImages(payload.receiptImages || []),
          notes: payload.notes?.trim() || null,
          original_client_id: originalClientId || null,
          updated_at: new Date(),
        },
      });
    } else {
      result = await prisma.client_payment_records.create({
        data: {
          tenant_id: tenantId,
          client_id: clientIdBig,
          original_client_id: originalClientId || null,
          product_id: productId,
          period_month: periodMonth,
          period_year: periodYear,
          status: payload.status,
          amount: new Prisma.Decimal(payload.amount),
          receipt_images: serializeReceiptImages(payload.receiptImages || []),
          notes: payload.notes?.trim() || null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    console.log(
      `[ClientPaymentService.upsertCell] Cell upserted: ID=${result.id}, originalClientId=${originalClientId}, clientIdNumeric=${clientIdBig}, productId=${productId}, period=${periodMonth}/${periodYear}, status=${payload.status}, TenantId=${tenantId}`
    );

    return { ...mapRecord(result), originalClientId } as any;
  }

  static async listClientsAndProducts(
    tenantId: string,
    opts?: { isSuperAdmin?: boolean }
  ) {
    void tenantId;
    void opts;

    const [clients, products] = await Promise.all([
      prisma.tenant.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true, phone: true },
      }),
      prisma.solution.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true },
      }),
    ]);

    const productsWithPrice = products.map((p) => ({
      id: String(p.id),
      name: p.name,
      code: p.code,
      price: 0,
    }));

    return { clients, products: productsWithPrice };
  }
}
