import { Prisma, PaymentStatusEnum } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type {
  CreateIncomeInput,
  UpdateIncomeInput,
  SetPaymentStatusInput,
} from '../validations/incomeValidation';

type AttachmentInput = {
  url: string;
  caption?: string;
};

type IncomeFilters = {
  tenantId: string | null;
  startDate?: Date;
  endDate?: Date;
  category?: string;
  status?: string;
  payment_status?: string;
  page?: number;
  limit?: number;
};

const incomeInclude = {
  attachments: {
    orderBy: { sort_order: 'asc' as const },
  },
};

export class IncomeService {
  static async createIncome(
    tenantId: string | null,
    payload: CreateIncomeInput & { attachments?: AttachmentInput[] }
  ) {
    if (!payload.title || !payload.title.trim()) {
      throw new AppError('Title pemasukan wajib diisi', 400);
    }

    if (!payload.category || !payload.category.trim()) {
      throw new AppError('Category pemasukan wajib diisi', 400);
    }

    if (!payload.income_date) {
      throw new AppError('Tanggal pemasukan wajib diisi', 400);
    }

    if (payload.amount === undefined || payload.amount === null || payload.amount < 0) {
      throw new AppError('Amount pemasukan tidak valid', 400);
    }

    const incomeDate = new Date(payload.income_date);
    if (Number.isNaN(incomeDate.getTime())) {
      throw new AppError('Format tanggal pemasukan tidak valid', 400);
    }

    const branchId =
      payload.branchId !== undefined
        ? BigInt(payload.branchId.toString())
        : null;

    const attachmentsData = payload.attachments ?? [];

    const income = await prisma.incomes.create({
      data: {
        tenant_id: tenantId,
        branchId,
        title: payload.title.trim(),
        category: payload.category.trim(),
        income_date: incomeDate,
        amount: new Prisma.Decimal(payload.amount),
        pic_name: payload.pic_name?.trim() || null,
        payment_status: (payload.payment_status as PaymentStatusEnum) ?? PaymentStatusEnum.Paid,
        notes: payload.notes?.trim() || null,
        attachment_url: payload.attachment_url?.trim() || null,
        status: payload.status ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
        attachments:
          attachmentsData.length > 0
            ? {
                create: attachmentsData.map((att, idx) => ({
                  tenant_id: tenantId,
                  url: att.url,
                  caption: att.caption?.trim() || null,
                  sort_order: idx,
                  created_at: new Date(),
                })),
              }
            : undefined,
      },
      include: incomeInclude,
    });

    console.log(
      `[IncomeService.createIncome] Income created: ID=${income.id}, Title="${income.title}", Category="${income.category}", Amount=${income.amount}, Date=${income.income_date.toISOString()}, PaymentStatus=${income.payment_status}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return income;
  }

  static async listIncomes(filters: IncomeFilters) {
    const {
      tenantId,
      startDate,
      endDate,
      category,
      status,
      payment_status,
      page = 1,
      limit = 50,
    } = filters;

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.incomesWhereInput = {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      ...(startDate || endDate
        ? {
            income_date: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(payment_status ? { payment_status: payment_status as PaymentStatusEnum } : {}),
    };

    const [incomes, total] = await Promise.all([
      prisma.incomes.findMany({
        where,
        orderBy: { income_date: 'desc' },
        skip,
        take: safeLimit,
        include: incomeInclude,
      }),
      prisma.incomes.count({ where }),
    ]);

    return {
      records: incomes,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  static async getIncomeById(tenantId: string | null, id: bigint) {
    const income = await prisma.incomes.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: incomeInclude,
    });

    if (!income) {
      return null;
    }

    return income;
  }

  static async updateIncome(
    tenantId: string | null,
    id: bigint,
    payload: UpdateIncomeInput & { attachments?: AttachmentInput[] }
  ) {
    const existing = await prisma.incomes.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: incomeInclude,
    });

    if (!existing) {
      throw new AppError('Pemasukan tidak ditemukan', 404);
    }

    const updateData: Prisma.incomesUpdateInput = {
      updated_at: new Date(),
    };

    if (payload.title !== undefined) {
      updateData.title = payload.title.trim();
    }
    if (payload.category !== undefined) {
      updateData.category = payload.category.trim();
    }
    if (payload.income_date !== undefined) {
      updateData.income_date = new Date(payload.income_date);
    }
    if (payload.amount !== undefined) {
      updateData.amount = new Prisma.Decimal(payload.amount);
    }
    if (payload.branchId !== undefined) {
      updateData.branchId = BigInt(payload.branchId.toString());
    }
    if (payload.pic_name !== undefined) {
      updateData.pic_name = payload.pic_name?.trim() || null;
    }
    if (payload.payment_status !== undefined) {
      updateData.payment_status = payload.payment_status as PaymentStatusEnum;
    }
    if (payload.notes !== undefined) {
      updateData.notes = payload.notes?.trim() || null;
    }
    if (payload.attachment_url !== undefined) {
      updateData.attachment_url = payload.attachment_url?.trim() || null;
    }
    if (payload.status !== undefined) {
      updateData.status = payload.status;
    }

    const attachmentsData = payload.attachments;

    if (attachmentsData !== undefined) {
      await prisma.income_attachments.deleteMany({
        where: { income_id: id },
      });

      if (attachmentsData.length > 0) {
        updateData.attachments = {
          create: attachmentsData.map((att, idx) => ({
            tenant_id: tenantId,
            url: att.url,
            caption: att.caption?.trim() || null,
            sort_order: idx,
            created_at: new Date(),
          })),
        };
      }
    }

    const updated = await prisma.incomes.update({
      where: { id },
      data: updateData,
      include: incomeInclude,
    });

    console.log(
      `[IncomeService.updateIncome] Income updated: ID=${id}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return updated;
  }

  static async voidIncome(tenantId: string | null, id: bigint, voidReason?: string) {
    const existing = await prisma.incomes.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: incomeInclude,
    });

    if (!existing) {
      throw new AppError('Pemasukan tidak ditemukan', 404);
    }

    if (existing.status === 'VOID') {
      throw new AppError('Pemasukan sudah dibatalkan sebelumnya', 400);
    }

    const voided = await prisma.incomes.update({
      where: { id },
      data: {
        status: 'VOID',
        void_reason: voidReason || null,
        voided_at: new Date(),
        updated_at: new Date(),
      },
      include: incomeInclude,
    });

    console.log(
      `[IncomeService.voidIncome] Income voided: ID=${id}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return voided;
  }

  static async setPaymentStatus(
    tenantId: string | null,
    id: bigint,
    payload: SetPaymentStatusInput
  ) {
    const existing = await prisma.incomes.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: incomeInclude,
    });

    if (!existing) {
      throw new AppError('Pemasukan tidak ditemukan', 404);
    }

    const updated = await prisma.incomes.update({
      where: { id },
      data: {
        payment_status: payload.payment_status as PaymentStatusEnum,
        updated_at: new Date(),
      },
      include: incomeInclude,
    });

    console.log(
      `[IncomeService.setPaymentStatus] Income payment status updated: ID=${id}, PaymentStatus=${updated.payment_status}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return updated;
  }

  static async deleteIncome(tenantId: string | null, id: bigint): Promise<void> {
    const existing = await prisma.incomes.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      select: { id: true },
    });

    if (!existing) {
      throw new AppError('Pemasukan tidak ditemukan', 404);
    }

    await prisma.$transaction([
      prisma.income_attachments.deleteMany({ where: { income_id: id } }),
      prisma.incomes.delete({ where: { id } }),
    ]);

    console.log(
      `[IncomeService.deleteIncome] Income deleted permanently: ID=${id}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );
  }
}
