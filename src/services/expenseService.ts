import { Prisma, PaymentStatusEnum } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type {
  CreateExpenseInput,
  UpdateExpenseInput,
  SetPaymentStatusInput,
} from '../validations/expenseValidation';

type AttachmentInput = {
  url: string;
  caption?: string;
};

type ExpenseFilters = {
  tenantId: string | null;
  startDate?: Date;
  endDate?: Date;
  category?: string;
  status?: string;
  payment_status?: string;
  page?: number;
  limit?: number;
};

const expenseInclude = {
  attachments: {
    orderBy: { sort_order: 'asc' as const },
  },
};

export class ExpenseService {
  static async createExpense(
    tenantId: string | null,
    payload: CreateExpenseInput & { attachments?: AttachmentInput[] }
  ) {
    if (!payload.title || !payload.title.trim()) {
      throw new AppError('Title pengeluaran wajib diisi', 400);
    }

    if (!payload.category || !payload.category.trim()) {
      throw new AppError('Category pengeluaran wajib diisi', 400);
    }

    if (!payload.expense_date) {
      throw new AppError('Tanggal pengeluaran wajib diisi', 400);
    }

    if (payload.amount === undefined || payload.amount === null || payload.amount < 0) {
      throw new AppError('Amount pengeluaran tidak valid', 400);
    }

    const expenseDate = new Date(payload.expense_date);
    if (Number.isNaN(expenseDate.getTime())) {
      throw new AppError('Format tanggal pengeluaran tidak valid', 400);
    }

    const branchId =
      payload.branchId !== undefined
        ? BigInt(payload.branchId.toString())
        : null;

    const attachmentsData = payload.attachments ?? [];

    const expense = await prisma.expenses.create({
      data: {
        tenant_id: tenantId,
        branchId,
        title: payload.title.trim(),
        category: payload.category.trim(),
        expense_date: expenseDate,
        amount: new Prisma.Decimal(payload.amount),
        pic_name: payload.pic_name?.trim() || null,
        payment_status: (payload.payment_status as PaymentStatusEnum) ?? PaymentStatusEnum.NotPaid,
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
      include: expenseInclude,
    });

    console.log(
      `[ExpenseService.createExpense] Expense created: ID=${expense.id}, Title="${expense.title}", Category="${expense.category}", Amount=${expense.amount}, Date=${expense.expense_date.toISOString()}, PaymentStatus=${expense.payment_status}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return expense;
  }

  static async listExpenses(filters: ExpenseFilters) {
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

    const where: Prisma.expensesWhereInput = {
      ...(tenantId ? { tenant_id: tenantId } : {}),
      ...(startDate || endDate
        ? {
            expense_date: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(payment_status ? { payment_status: payment_status as PaymentStatusEnum } : {}),
    };

    const [expenses, total] = await Promise.all([
      prisma.expenses.findMany({
        where,
        orderBy: { expense_date: 'desc' },
        skip,
        take: safeLimit,
        include: expenseInclude,
      }),
      prisma.expenses.count({ where }),
    ]);

    return {
      records: expenses,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  static async getExpenseById(tenantId: string | null, id: bigint) {
    const expense = await prisma.expenses.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: expenseInclude,
    });

    if (!expense) {
      return null;
    }

    return expense;
  }

  static async updateExpense(
    tenantId: string | null,
    id: bigint,
    payload: UpdateExpenseInput & { attachments?: AttachmentInput[] }
  ) {
    const existing = await prisma.expenses.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: expenseInclude,
    });

    if (!existing) {
      throw new AppError('Pengeluaran tidak ditemukan', 404);
    }

    const updateData: Prisma.expensesUpdateInput = {
      updated_at: new Date(),
    };

    if (payload.title !== undefined) {
      updateData.title = payload.title.trim();
    }
    if (payload.category !== undefined) {
      updateData.category = payload.category.trim();
    }
    if (payload.expense_date !== undefined) {
      updateData.expense_date = new Date(payload.expense_date);
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
      await prisma.expense_attachments.deleteMany({
        where: { expense_id: id },
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

    const updated = await prisma.expenses.update({
      where: { id },
      data: updateData,
      include: expenseInclude,
    });

    console.log(
      `[ExpenseService.updateExpense] Expense updated: ID=${id}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return updated;
  }

  static async voidExpense(tenantId: string | null, id: bigint, voidReason?: string) {
    const existing = await prisma.expenses.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: expenseInclude,
    });

    if (!existing) {
      throw new AppError('Pengeluaran tidak ditemukan', 404);
    }

    if (existing.status === 'VOID') {
      throw new AppError('Pengeluaran sudah dibatalkan sebelumnya', 400);
    }

    const voided = await prisma.expenses.update({
      where: { id },
      data: {
        status: 'VOID',
        void_reason: voidReason || null,
        voided_at: new Date(),
        updated_at: new Date(),
      },
      include: expenseInclude,
    });

    console.log(
      `[ExpenseService.voidExpense] Expense voided: ID=${id}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return voided;
  }

  static async setPaymentStatus(
    tenantId: string | null,
    id: bigint,
    payload: SetPaymentStatusInput
  ) {
    const existing = await prisma.expenses.findFirst({
      where: {
        id,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
      include: expenseInclude,
    });

    if (!existing) {
      throw new AppError('Pengeluaran tidak ditemukan', 404);
    }

    const updated = await prisma.expenses.update({
      where: { id },
      data: {
        payment_status: payload.payment_status as PaymentStatusEnum,
        updated_at: new Date(),
      },
      include: expenseInclude,
    });

    console.log(
      `[ExpenseService.setPaymentStatus] Expense payment status updated: ID=${id}, PaymentStatus=${updated.payment_status}, TenantId=${tenantId ?? '<GLOBAL>'}`
    );

    return updated;
  }
}
