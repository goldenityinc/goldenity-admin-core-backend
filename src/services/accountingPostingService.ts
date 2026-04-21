import {
  AccountCategoryType,
  AccountNormalBalance,
  JournalEntrySourceType,
  Prisma,
} from '@prisma/client';
import prisma from '../config/database';

type SettlementAccountKind = 'cash' | 'bank';

type JournalLineDraft = {
  chartOfAccountId: string;
  description: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
};

type AccountResolverOptions = {
  tenantId: string;
  categoryCode: AccountCategoryType;
  preferredNames: string[];
  preferredCodes: string[];
  fallbackName: string;
  fallbackCode: string;
  normalBalance: AccountNormalBalance;
};

const BANK_PAYMENT_KEYWORDS = [
  'bank',
  'transfer',
  'debit',
  'credit',
  'card',
  'visa',
  'mastercard',
  'qris',
  'edc',
  'ovo',
  'gopay',
  'dana',
  'linkaja',
  'shopeepay',
  'ewallet',
  'e-wallet',
];

const SALES_BLOCKED_STATUSES = new Set([
  'void',
  'voided',
  'cancelled',
  'canceled',
  'refunded',
]);

const SALES_FINAL_STATUSES = new Set([
  'paid',
  'lunas',
  'settled',
  'completed',
  'success',
]);

const EXPENSE_BLOCKED_STATUSES = new Set([
  'void',
  'voided',
  'cancelled',
  'canceled',
  'reversed',
]);

export class AccountingPostingService {
  private static readonly ZERO = new Prisma.Decimal(0);

  static async postSalesToJournal(salesTransactionId: string, tenantId: string) {
    const salesRecordId = this.parseBigIntId(salesTransactionId, 'salesTransactionId');

    return prisma.$transaction(async (tx) => {
      const existingEntry = await this.findExistingEntry(
        tx,
        tenantId,
        JournalEntrySourceType.POS_SALE,
        salesTransactionId,
      );
      if (existingEntry) {
        return existingEntry;
      }

      const sale = await tx.sales_records.findFirst({
        where: {
          id: salesRecordId,
          tenant_id: tenantId,
        },
      });

      if (!sale) {
        throw new Error(
          `Sales transaction ${salesTransactionId} tidak ditemukan untuk tenant ${tenantId}.`,
        );
      }

      this.assertSalesEligibleForPosting(sale);

      const settlementAmount = this.resolveSalesSettlementAmount(sale);
      const discountAmount = this.toDecimal(sale.total_discount);
      const taxAmount = this.toDecimal(sale.total_tax);
      const revenueAmount = settlementAmount.plus(discountAmount).minus(taxAmount);

      if (!revenueAmount.gt(this.ZERO)) {
        throw new Error(
          `Sales transaction ${salesTransactionId} menghasilkan nilai pendapatan tidak valid.`,
        );
      }

      const settlementAccount = await this.resolveSettlementAccount(
        tx,
        tenantId,
        sale.payment_method,
      );
      const revenueAccount = await this.resolveAccount(tx, {
        tenantId,
        categoryCode: AccountCategoryType.REVENUE,
        preferredNames: ['pendapatan penjualan', 'sales revenue', 'penjualan'],
        preferredCodes: ['4100', '4110', 'SALES', 'REV-SALES'],
        fallbackName: 'Pendapatan Penjualan',
        fallbackCode: '4110',
        normalBalance: AccountNormalBalance.CREDIT,
      });

      const lines: JournalLineDraft[] = [
        {
          chartOfAccountId: settlementAccount.id,
          description: `Penerimaan ${this.describeSettlementAccountKind(sale.payment_method)}`,
          debit: settlementAmount,
          credit: this.ZERO,
        },
        {
          chartOfAccountId: revenueAccount.id,
          description: 'Pengakuan pendapatan penjualan',
          debit: this.ZERO,
          credit: revenueAmount,
        },
      ];

      if (discountAmount.gt(this.ZERO)) {
        const discountAccount = await this.resolveAccount(tx, {
          tenantId,
          categoryCode: AccountCategoryType.EXPENSE,
          preferredNames: ['diskon penjualan', 'sales discount', 'discount allowed'],
          preferredCodes: ['5120', 'DISC-SALES', 'DISC'],
          fallbackName: 'Diskon Penjualan',
          fallbackCode: '5120',
          normalBalance: AccountNormalBalance.DEBIT,
        });

        lines.push({
          chartOfAccountId: discountAccount.id,
          description: 'Diskon penjualan',
          debit: discountAmount,
          credit: this.ZERO,
        });
      }

      if (taxAmount.gt(this.ZERO)) {
        const taxAccount = await this.resolveAccount(tx, {
          tenantId,
          categoryCode: AccountCategoryType.LIABILITY,
          preferredNames: ['utang ppn', 'ppn keluaran', 'tax payable', 'vat payable'],
          preferredCodes: ['2110', 'TAX-OUT', 'VAT-PAY'],
          fallbackName: 'Utang PPN',
          fallbackCode: '2110',
          normalBalance: AccountNormalBalance.CREDIT,
        });

        lines.push({
          chartOfAccountId: taxAccount.id,
          description: 'PPN keluaran',
          debit: this.ZERO,
          credit: taxAmount,
        });
      }

      const totals = this.calculateTotals(lines);
      this.assertBalanced(totals.totalDebit, totals.totalCredit, salesTransactionId);

      const entryNumber = await this.generateEntryNumber(tx, tenantId, 'POS');
      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber,
          entryDate: sale.created_at ?? new Date(),
          sourceType: JournalEntrySourceType.POS_SALE,
          referenceId: salesTransactionId,
          referenceNumber:
            sale.receipt_number ?? sale.reference_id ?? salesTransactionId,
          description: `Posting otomatis penjualan POS ${
            sale.receipt_number ?? sale.reference_id ?? salesTransactionId
          }`,
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
          isPosted: true,
          postedAt: new Date(),
        },
      });

      await tx.journalLine.createMany({
        data: lines.map((line, index) => ({
          journalEntryId: entry.id,
          chartOfAccountId: line.chartOfAccountId,
          lineNumber: index + 1,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
        })),
      });

      return this.loadJournalEntry(tx, entry.id);
    });
  }

  static async postExpenseToJournal(expenseTransactionId: string, tenantId: string) {
    const expenseId = this.parseBigIntId(expenseTransactionId, 'expenseTransactionId');

    return prisma.$transaction(async (tx) => {
      const existingEntry = await this.findExistingEntry(
        tx,
        tenantId,
        JournalEntrySourceType.EXPENSE,
        expenseTransactionId,
      );
      if (existingEntry) {
        return existingEntry;
      }

      const expense = await tx.expenses.findFirst({
        where: {
          id: expenseId,
          tenant_id: tenantId,
        },
      });

      if (!expense) {
        throw new Error(
          `Expense transaction ${expenseTransactionId} tidak ditemukan untuk tenant ${tenantId}.`,
        );
      }

      this.assertExpenseEligibleForPosting(expense);

      const expenseAmount = this.toDecimal(expense.amount);
      if (!expenseAmount.gt(this.ZERO)) {
        throw new Error(
          `Expense transaction ${expenseTransactionId} memiliki nominal tidak valid.`,
        );
      }

      const expenseAccount = await this.resolveAccount(tx, {
        tenantId,
        categoryCode: AccountCategoryType.EXPENSE,
        preferredNames: this.buildExpenseNameHints(expense.notes),
        preferredCodes: ['5100', '5101', 'EXP-OPS', 'OPEX'],
        fallbackName: 'Beban Operasional',
        fallbackCode: '5100',
        normalBalance: AccountNormalBalance.DEBIT,
      });
      const settlementAccount = await this.resolveExpenseSettlementAccount(
        tx,
        tenantId,
        expense.notes,
      );

      const lines: JournalLineDraft[] = [
        {
          chartOfAccountId: expenseAccount.id,
          description: expense.notes?.trim() || 'Pengakuan beban operasional',
          debit: expenseAmount,
          credit: this.ZERO,
        },
        {
          chartOfAccountId: settlementAccount.id,
          description: `Pembayaran beban via ${settlementAccount.name}`,
          debit: this.ZERO,
          credit: expenseAmount,
        },
      ];

      const totals = this.calculateTotals(lines);
      this.assertBalanced(totals.totalDebit, totals.totalCredit, expenseTransactionId);

      const entryNumber = await this.generateEntryNumber(tx, tenantId, 'EXP');
      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber,
          entryDate: expense.created_at ?? new Date(),
          sourceType: JournalEntrySourceType.EXPENSE,
          referenceId: expenseTransactionId,
          referenceNumber: `EXP-${expenseTransactionId}`,
          description: `Posting otomatis expense ${expenseTransactionId}`,
          totalDebit: totals.totalDebit,
          totalCredit: totals.totalCredit,
          isPosted: true,
          postedAt: new Date(),
        },
      });

      await tx.journalLine.createMany({
        data: lines.map((line, index) => ({
          journalEntryId: entry.id,
          chartOfAccountId: line.chartOfAccountId,
          lineNumber: index + 1,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
        })),
      });

      return this.loadJournalEntry(tx, entry.id);
    });
  }

  private static async findExistingEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceType: JournalEntrySourceType,
    referenceId: string,
  ) {
    return tx.journalEntry.findFirst({
      where: {
        tenantId,
        sourceType,
        referenceId,
      },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { account: true },
        },
      },
    });
  }

  private static async loadJournalEntry(tx: Prisma.TransactionClient, journalEntryId: string) {
    return tx.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { account: true },
        },
      },
    });
  }

  private static assertSalesEligibleForPosting(sale: {
    payment_status: string | null;
    remaining_balance: Prisma.Decimal | null;
    outstanding_balance: Prisma.Decimal | null;
  }) {
    const paymentStatus = this.normalizeText(sale.payment_status);

    if (SALES_BLOCKED_STATUSES.has(paymentStatus)) {
      throw new Error(`Sales transaction dengan status ${paymentStatus} tidak boleh diposting.`);
    }

    const hasOutstanding = this.toDecimal(sale.remaining_balance)
      .plus(this.toDecimal(sale.outstanding_balance))
      .gt(this.ZERO);
    if (hasOutstanding && !SALES_FINAL_STATUSES.has(paymentStatus)) {
      throw new Error('Sales transaction masih memiliki outstanding balance dan belum final.');
    }
  }

  private static assertExpenseEligibleForPosting(expense: { status: string | null }) {
    const status = this.normalizeText(expense.status);
    if (status && EXPENSE_BLOCKED_STATUSES.has(status)) {
      throw new Error(`Expense dengan status ${status} tidak boleh diposting.`);
    }
  }

  private static resolveSalesSettlementAmount(sale: {
    total_amount: Prisma.Decimal | null;
    total_price: Prisma.Decimal | null;
    amount_paid: Prisma.Decimal | null;
  }) {
    const candidates = [sale.total_amount, sale.total_price, sale.amount_paid]
      .map((value) => this.toDecimal(value))
      .filter((value) => value.gt(this.ZERO));

    if (candidates.length === 0) {
      throw new Error('Sales transaction tidak memiliki nilai total yang valid untuk diposting.');
    }

    return candidates[0];
  }

  private static calculateTotals(lines: JournalLineDraft[]) {
    return lines.reduce(
      (totals, line) => ({
        totalDebit: totals.totalDebit.plus(line.debit),
        totalCredit: totals.totalCredit.plus(line.credit),
      }),
      {
        totalDebit: this.ZERO,
        totalCredit: this.ZERO,
      },
    );
  }

  private static assertBalanced(
    totalDebit: Prisma.Decimal,
    totalCredit: Prisma.Decimal,
    referenceId: string,
  ) {
    if (!totalDebit.equals(totalCredit)) {
      throw new Error(
        `Journal lines untuk referensi ${referenceId} tidak balance: debit ${totalDebit.toFixed(
          2,
        )} kredit ${totalCredit.toFixed(2)}.`,
      );
    }
  }

  private static async resolveSettlementAccount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentMethod: string | null,
  ) {
    const kind = this.inferSettlementKind(paymentMethod);

    if (kind === 'bank') {
      return this.resolveAccount(tx, {
        tenantId,
        categoryCode: AccountCategoryType.ASSET,
        preferredNames: ['bank', 'kas bank', 'rekening', 'giro'],
        preferredCodes: ['1120', 'BANK', 'BANK-OPERASIONAL'],
        fallbackName: 'Bank Operasional',
        fallbackCode: '1120',
        normalBalance: AccountNormalBalance.DEBIT,
      });
    }

    return this.resolveAccount(tx, {
      tenantId,
      categoryCode: AccountCategoryType.ASSET,
      preferredNames: ['kas', 'cash', 'petty cash'],
      preferredCodes: ['1110', 'CASH', 'PETTY-CASH'],
      fallbackName: 'Kas',
      fallbackCode: '1110',
      normalBalance: AccountNormalBalance.DEBIT,
    });
  }

  private static async resolveExpenseSettlementAccount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    notes: string | null,
  ) {
    return this.resolveSettlementAccount(tx, tenantId, notes);
  }

  private static async resolveAccount(
    tx: Prisma.TransactionClient,
    options: AccountResolverOptions,
  ) {
    const filters: Prisma.ChartOfAccountWhereInput[] = [];

    for (const nameHint of options.preferredNames) {
      const normalizedHint = nameHint.trim();
      if (!normalizedHint) {
        continue;
      }

      filters.push({
        name: {
          contains: normalizedHint,
          mode: 'insensitive',
        },
      });
    }

    for (const codeHint of options.preferredCodes) {
      const normalizedHint = codeHint.trim();
      if (!normalizedHint) {
        continue;
      }

      filters.push({
        code: {
          contains: normalizedHint,
          mode: 'insensitive',
        },
      });
    }

    const prioritizedAccount = await tx.chartOfAccount.findFirst({
      where: {
        tenantId: options.tenantId,
        isActive: true,
        category: {
          code: options.categoryCode,
        },
        ...(filters.length > 0 ? { OR: filters } : {}),
      },
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
    });

    if (prioritizedAccount) {
      return prioritizedAccount;
    }

    const firstAccountInCategory = await tx.chartOfAccount.findFirst({
      where: {
        tenantId: options.tenantId,
        isActive: true,
        category: {
          code: options.categoryCode,
        },
      },
      orderBy: [{ isSystem: 'desc' }, { code: 'asc' }],
    });

    if (firstAccountInCategory) {
      return firstAccountInCategory;
    }

    return this.createFallbackAccount(tx, options);
  }

  private static async createFallbackAccount(
    tx: Prisma.TransactionClient,
    options: AccountResolverOptions,
  ) {
    const category = await tx.accountCategory.findUnique({
      where: { code: options.categoryCode },
    });

    if (!category) {
      throw new Error(
        `Account category ${options.categoryCode} belum tersedia. Jalankan seedAccountCategories terlebih dahulu.`,
      );
    }

    const code = await this.generateAccountCode(tx, options.tenantId, options.fallbackCode);

    return tx.chartOfAccount.create({
      data: {
        tenantId: options.tenantId,
        accountCategoryId: category.id,
        code,
        name: options.fallbackName,
        normalBalance: options.normalBalance,
        isSystem: true,
        isActive: true,
      },
    });
  }

  private static async generateAccountCode(
    tx: Prisma.TransactionClient,
    tenantId: string,
    baseCode: string,
  ) {
    let code = baseCode;
    let suffix = 1;

    while (
      await tx.chartOfAccount.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code,
          },
        },
      })
    ) {
      code = `${baseCode}-${suffix}`;
      suffix += 1;
    }

    return code;
  }

  private static async generateEntryNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    prefix: string,
  ) {
    let attempt = 0;

    while (attempt < 20) {
      attempt += 1;
      const now = new Date();
      const entryNumber = [
        prefix,
        now.getUTCFullYear().toString(),
        (now.getUTCMonth() + 1).toString().padStart(2, '0'),
        now.getUTCDate().toString().padStart(2, '0'),
        now.getUTCHours().toString().padStart(2, '0'),
        now.getUTCMinutes().toString().padStart(2, '0'),
        now.getUTCSeconds().toString().padStart(2, '0'),
        now.getUTCMilliseconds().toString().padStart(3, '0'),
        attempt.toString().padStart(2, '0'),
      ].join('');

      const existingEntry = await tx.journalEntry.findUnique({
        where: {
          tenantId_entryNumber: {
            tenantId,
            entryNumber,
          },
        },
      });

      if (!existingEntry) {
        return entryNumber;
      }
    }

    throw new Error('Gagal menghasilkan nomor jurnal unik.');
  }

  private static buildExpenseNameHints(notes: string | null) {
    const normalizedNotes = this.normalizeText(notes);
    return ['beban operasional', 'operational expense', 'expense', normalizedNotes].filter(
      (value) => value.length > 0,
    );
  }

  private static inferSettlementKind(paymentMethodOrNotes: string | null): SettlementAccountKind {
    const normalizedValue = this.normalizeText(paymentMethodOrNotes);
    if (!normalizedValue) {
      return 'cash';
    }

    if (BANK_PAYMENT_KEYWORDS.some((keyword) => normalizedValue.includes(keyword))) {
      return 'bank';
    }

    return 'cash';
  }

  private static describeSettlementAccountKind(paymentMethod: string | null) {
    return this.inferSettlementKind(paymentMethod) === 'bank' ? 'bank' : 'kas';
  }

  private static normalizeText(value: string | null | undefined) {
    return (value ?? '').trim().toLowerCase();
  }

  private static parseBigIntId(value: string, parameterName: string) {
    const trimmedValue = value.trim();
    if (!/^\d+$/.test(trimmedValue)) {
      throw new Error(`${parameterName} harus berupa numeric string.`);
    }

    return BigInt(trimmedValue);
  }

  private static toDecimal(value: Prisma.Decimal | bigint | number | string | null | undefined) {
    if (value == null) {
      return this.ZERO;
    }

    if (value instanceof Prisma.Decimal) {
      return value;
    }

    if (typeof value === 'bigint') {
      return new Prisma.Decimal(value.toString());
    }

    return new Prisma.Decimal(value);
  }
}

export default AccountingPostingService;