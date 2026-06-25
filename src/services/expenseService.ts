import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type { CreateExpenseInput, UpdateExpenseInput } from '../validations/expenseValidation';

type ExpenseFilters = {
  tenantId: string;
  startDate?: Date;
  endDate?: Date;
  category?: string;
  status?: string;
  page?: number;
  limit?: number;
};

export class ExpenseService {
  /**
   * Create a new expense record
   * Accepts: title, category, expense_date, amount, notes, status
   */
  static async createExpense(tenantId: string, payload: CreateExpenseInput) {
    // Validate that required fields are provided from frontend
    if (!payload.title || !payload.title.trim()) {
      throw new AppError('Title pengeluaran wajib diisi', 400);
    }

    if (!payload.category || !payload.category.trim()) {
      throw new AppError('Category pengeluaran wajib diisi', 400);
    }

    if (!payload.expense_date) {
      throw new AppError('Tanggal pengeluaran wajib diisi', 400);
    }

    if (!payload.amount || payload.amount <= 0) {
      throw new AppError('Amount pengeluaran harus lebih dari 0', 400);
    }

    const expenseDate = new Date(payload.expense_date);
    if (Number.isNaN(expenseDate.getTime())) {
      throw new AppError('Format tanggal pengeluaran tidak valid', 400);
    }

    const expense = await prisma.expenses.create({
      data: {
        tenant_id: tenantId,
        // Extract from request body - CRITICAL: Don't use hardcoded defaults
        title: payload.title.trim(),
        category: payload.category.trim(),
        expense_date: expenseDate,
        amount: new Prisma.Decimal(payload.amount),
        notes: payload.notes?.trim() || null,
        attachment_url: payload.attachment_url?.trim() || null,
        status: payload.status ?? 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    console.log(
      `[ExpenseService.createExpense] Expense created: ID=${expense.id}, Title="${expense.title}", Category="${expense.category}", Amount=${expense.amount}, Date=${expense.expense_date.toISOString()}, TenantId=${tenantId}`
    );

    return expense;
  }

  /**
   * List expenses with filters and pagination
   */
  static async listExpenses(filters: ExpenseFilters) {
    const {
      tenantId,
      startDate,
      endDate,
      category,
      status,
      page = 1,
      limit = 50,
    } = filters;

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.expensesWhereInput = {
      tenant_id: tenantId,
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
    };

    const [expenses, total] = await Promise.all([
      prisma.expenses.findMany({
        where,
        orderBy: { expense_date: 'desc' },
        skip,
        take: safeLimit,
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

  /**
   * Get a single expense by ID
   */
  static async getExpenseById(tenantId: string, id: bigint) {
    const expense = await prisma.expenses.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
    });

    if (!expense) {
      return null;
    }

    return expense;
  }

  /**
   * Update an expense record
   */
  static async updateExpense(
    tenantId: string,
    id: bigint,
    payload: UpdateExpenseInput,
  ) {
    // Verify expense exists and belongs to tenant
    const existing = await prisma.expenses.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
    });

    if (!existing) {
      throw new AppError('Pengeluaran tidak ditemukan', 404);
    }

    const updateData: Prisma.expensesUpdateInput = {
      updated_at: new Date(),
    };

    // Only update fields that are provided
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
    if (payload.notes !== undefined) {
      updateData.notes = payload.notes?.trim() || null;
    }
    if (payload.attachment_url !== undefined) {
      updateData.attachment_url = payload.attachment_url?.trim() || null;
    }
    if (payload.status !== undefined) {
      updateData.status = payload.status;
    }

    const updated = await prisma.expenses.update({
      where: { id },
      data: updateData,
    });

    console.log(
      `[ExpenseService.updateExpense] Expense updated: ID=${id}, TenantId=${tenantId}`
    );

    return updated;
  }

  /**
   * Delete (void) an expense record
   */
  static async voidExpense(tenantId: string, id: bigint, voidReason?: string) {
    const existing = await prisma.expenses.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
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
    });

    console.log(
      `[ExpenseService.voidExpense] Expense voided: ID=${id}, TenantId=${tenantId}`
    );

    return voided;
  }
}
