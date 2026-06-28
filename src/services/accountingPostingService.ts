import {
  AccountCategoryType,
  AccountNormalBalance,
  JournalEntrySourceType,
  Prisma,
} from '@prisma/client';
import prisma from '../config/database';

type SettlementAccountKind = 'cash' | 'bank';
type SalesSettlementKind = 'cash' | 'receivable';

type JournalLineDraft = {
  chartOfAccountId: string;
  description: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
};

type JournalEntryDraft = {
  branchId: bigint | null;
  entryDate: Date;
  sourceType: JournalEntrySourceType;
  referenceId: string;
  referenceNumber: string;
  description: string;
  totalDebit: Prisma.Decimal;
  totalCredit: Prisma.Decimal;
  lines: JournalLineDraft[];
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

const KASBON_PAYMENT_KEYWORDS = [
  'kasbon',
  'piutang',
  'hutang',
  'utang',
  'credit',
  'kredit',
  'tempo',
];

const KASBON_UNPAID_STATUSES = new Set([
  'kasbon',
  'belum lunas',
  'unpaid',
  'pending',
  'pending_payment',
  'partial',
  'partially_paid',
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

      const hasKasbonPayments =
        (await tx.kas_bon_payment_history.count({
          where: {
            tenant_id: tenantId,
            sales_record_id: salesRecordId,
          },
        })) > 0;

      const draft = await this.buildSalesJournalDraft(
        tx,
        tenantId,
        salesTransactionId,
        sale,
        hasKasbonPayments,
      );

      const existingEntry = await this.findExistingSalesEntry(
        tx,
        tenantId,
        salesTransactionId,
        draft.referenceNumber,
      );
      if (existingEntry) {
        return this.syncJournalEntry(tx, existingEntry.id, draft);
      }

      return this.createJournalEntry(tx, tenantId, 'POS', draft);
    });
  }

  static async resetLedgerForTenant(tenantId: string) {
    const [salesCount, expenseCount, kasbonPaymentCount] = await Promise.all([
      prisma.sales_records.count({ where: { tenant_id: tenantId } }),
      prisma.expenses.count({ where: { tenant_id: tenantId } }),
      prisma.kas_bon_payment_history.count({ where: { tenant_id: tenantId } }),
    ]);

    const journalEntryIds = await prisma.journalEntry.findMany({
      where: { tenantId },
      select: { id: true },
    });

    if (journalEntryIds.length > 0) {
      await prisma.journalLine.deleteMany({
        where: {
          journalEntryId: {
            in: journalEntryIds.map((entry) => entry.id),
          },
        },
      });
    }

    await prisma.journalEntry.deleteMany({
      where: { tenantId },
    });

    const rebuildUpperBound = new Date('2100-01-01T00:00:00.000Z');
    await this.ensureSalesPostedForDateRange(tenantId, null, rebuildUpperBound);
    await this.ensureExpensesPostedForDateRange(tenantId, null, rebuildUpperBound);
    await this.ensureKasbonPaymentsPostedForDateRange(tenantId, null, rebuildUpperBound);

    const rebuiltEntries = await prisma.journalEntry.count({
      where: { tenantId },
    });

    return {
      tenantId,
      deletedEntries: journalEntryIds.length,
      rebuiltEntries,
      sourceCounts: {
        sales: salesCount,
        expenses: expenseCount,
        kasbonPayments: kasbonPaymentCount,
      },
    };
  }

  static async ensureSalesPostedForDateRange(
    tenantId: string,
    startDate: Date | null,
    endDate: Date,
  ) {
    const salesRecords = await prisma.sales_records.findMany({
      where: {
        tenant_id: tenantId,
        created_at: {
          ...(startDate ? { gte: startDate } : {}),
          lte: endDate,
        },
        NOT: {
          payment_status: {
            in: Array.from(SALES_BLOCKED_STATUSES),
            mode: 'insensitive',
          },
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    for (const salesRecord of salesRecords) {
      try {
        await this.postSalesToJournal(salesRecord.id.toString(), tenantId);
      } catch (error) {
        if (this.isIgnorableSalesPostingError(error)) {
          continue;
        }
        throw error;
      }
    }
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

  static async ensureExpensesPostedForDateRange(
    tenantId: string,
    startDate: Date | null,
    endDate: Date,
  ) {
    const expenses = await prisma.expenses.findMany({
      where: {
        tenant_id: tenantId,
        created_at: {
          ...(startDate ? { gte: startDate } : {}),
          lte: endDate,
        },
        NOT: {
          status: {
            in: Array.from(EXPENSE_BLOCKED_STATUSES),
            mode: 'insensitive',
          },
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    for (const expense of expenses) {
      try {
        await this.postExpenseToJournal(expense.id.toString(), tenantId);
      } catch (error) {
        if (this.isIgnorableExpensePostingError(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  static async postKasbonPaymentToJournal(paymentHistoryId: string, tenantId: string) {
    const kasbonPaymentId = this.parseBigIntId(paymentHistoryId, 'paymentHistoryId');

    return prisma.$transaction(async (tx) => {
      const referenceId = `KASBON_PAYMENT:${paymentHistoryId}`;
      const existingEntry = await this.findExistingEntry(
        tx,
        tenantId,
        JournalEntrySourceType.ADJUSTMENT,
        referenceId,
      );
      if (existingEntry) {
        return existingEntry;
      }

      const payment = await tx.kas_bon_payment_history.findFirst({
        where: {
          id: kasbonPaymentId,
          tenant_id: tenantId,
        },
      });

      if (!payment) {
        throw new Error(
          `Kasbon payment ${paymentHistoryId} tidak ditemukan untuk tenant ${tenantId}.`,
        );
      }

      const paidAmount = this.toDecimal(payment.paid_amount);
      if (!paidAmount.gt(this.ZERO)) {
        throw new Error(`Kasbon payment ${paymentHistoryId} memiliki nominal tidak valid.`);
      }

      const [cashAccount, receivableAccount, salesRecord] = await Promise.all([
        this.resolveCashOnHandAccount(tx, tenantId),
        this.resolveReceivableAccount(tx, tenantId),
        tx.sales_records.findFirst({
          where: {
            id: payment.sales_record_id,
            tenant_id: tenantId,
          },
          select: {
            receipt_number: true,
            reference_id: true,
          },
        }),
      ]);

      const lines: JournalLineDraft[] = [
        {
          chartOfAccountId: cashAccount.id,
          description: 'Penerimaan kas pelunasan kasbon',
          debit: paidAmount,
          credit: this.ZERO,
        },
        {
          chartOfAccountId: receivableAccount.id,
          description: 'Pengurangan piutang usaha kasbon',
          debit: this.ZERO,
          credit: paidAmount,
        },
      ];

      const totals = this.calculateTotals(lines);
      this.assertBalanced(totals.totalDebit, totals.totalCredit, paymentHistoryId);

      const entryNumber = await this.generateEntryNumber(tx, tenantId, 'KBP');
      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          entryNumber,
          entryDate: payment.paid_at ?? payment.created_at ?? new Date(),
          sourceType: JournalEntrySourceType.ADJUSTMENT,
          referenceId,
          referenceNumber:
            salesRecord?.receipt_number ??
            salesRecord?.reference_id ??
            `KASBON-${payment.sales_record_id.toString()}-${payment.id.toString()}`,
          description: `Pelunasan kasbon #${payment.id.toString()}`,
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

  static async ensureKasbonPaymentsPostedForDateRange(
    tenantId: string,
    startDate: Date | null,
    endDate: Date,
  ) {
    const payments = await prisma.kas_bon_payment_history.findMany({
      where: {
        tenant_id: tenantId,
        OR: [
          {
            paid_at: {
              ...(startDate ? { gte: startDate } : {}),
              lte: endDate,
            },
          },
          {
            paid_at: null,
            created_at: {
              ...(startDate ? { gte: startDate } : {}),
              lte: endDate,
            },
          },
        ],
      },
      select: {
        id: true,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    for (const payment of payments) {
      try {
        await this.postKasbonPaymentToJournal(payment.id.toString(), tenantId);
      } catch (error) {
        if (this.isIgnorableKasbonPostingError(error)) {
          continue;
        }
        throw error;
      }
    }
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

  private static async findExistingSalesEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    referenceId: string,
    referenceNumber: string,
  ) {
    return tx.journalEntry.findFirst({
      where: {
        tenantId,
        sourceType: JournalEntrySourceType.POS_SALE,
        OR: [
          { referenceId },
          ...(referenceNumber.trim().length > 0 ? [{ referenceNumber }] : []),
        ],
      },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { account: true },
        },
      },
      orderBy: [{ postedAt: 'asc' }, { createdAt: 'asc' }],
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

  private static async createJournalEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entryNumberPrefix: string,
    draft: JournalEntryDraft,
  ) {
    const entryNumber = await this.generateEntryNumber(tx, tenantId, entryNumberPrefix);
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        branchId: draft.branchId,
        entryNumber,
        entryDate: draft.entryDate,
        sourceType: draft.sourceType,
        referenceId: draft.referenceId,
        referenceNumber: draft.referenceNumber,
        description: draft.description,
        totalDebit: draft.totalDebit,
        totalCredit: draft.totalCredit,
        isPosted: true,
        postedAt: new Date(),
      },
    });

    await tx.journalLine.createMany({
      data: draft.lines.map((line, index) => ({
        journalEntryId: entry.id,
        chartOfAccountId: line.chartOfAccountId,
        lineNumber: index + 1,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
      })),
    });

    return this.loadJournalEntry(tx, entry.id);
  }

  private static async syncJournalEntry(
    tx: Prisma.TransactionClient,
    journalEntryId: string,
    draft: JournalEntryDraft,
  ) {
    await tx.journalEntry.update({
      where: { id: journalEntryId },
      data: {
        branchId: draft.branchId,
        entryDate: draft.entryDate,
        sourceType: draft.sourceType,
        referenceId: draft.referenceId,
        referenceNumber: draft.referenceNumber,
        description: draft.description,
        totalDebit: draft.totalDebit,
        totalCredit: draft.totalCredit,
        isPosted: true,
        postedAt: new Date(),
      },
    });

    await tx.journalLine.deleteMany({
      where: { journalEntryId },
    });

    await tx.journalLine.createMany({
      data: draft.lines.map((line, index) => ({
        journalEntryId,
        chartOfAccountId: line.chartOfAccountId,
        lineNumber: index + 1,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
      })),
    });

    return this.loadJournalEntry(tx, journalEntryId);
  }

  private static assertSalesEligibleForPosting(sale: {
    payment_method: string | null;
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
    if (
      hasOutstanding &&
      !SALES_FINAL_STATUSES.has(paymentStatus) &&
      !this.isKasbonLikePayment(sale.payment_method, sale.payment_status)
    ) {
      throw new Error('Sales transaction masih memiliki outstanding balance dan belum final.');
    }
  }

  private static async buildSalesJournalDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    salesTransactionId: string,
    sale: {
      branch_id: bigint | null;
      created_at: Date | null;
      receipt_number: string | null;
      reference_id: string | null;
      payment_method: string | null;
      payment_status: string | null;
      remaining_balance: Prisma.Decimal | null;
      outstanding_balance: Prisma.Decimal | null;
      total_amount: Prisma.Decimal | null;
      total_price: Prisma.Decimal | null;
      amount_paid: Prisma.Decimal | null;
      total_discount: bigint | null;
      total_tax: bigint | null;
    },
    forceReceivable: boolean,
  ): Promise<JournalEntryDraft> {
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

    const settlementKind = this.inferSalesSettlementKind(sale, forceReceivable);
    const settlementAccount = await this.resolveSalesSettlementAccount(
      tx,
      tenantId,
      settlementKind,
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
        description:
          settlementKind === 'receivable'
            ? 'Pengakuan piutang penjualan kasbon'
            : `Penerimaan ${this.describeSalesSettlementKind(settlementKind)}`,
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

    const referenceNumber =
      sale.receipt_number ?? sale.reference_id ?? salesTransactionId;

    return {
      branchId: sale.branch_id ?? null,
      entryDate: sale.created_at ?? new Date(),
      sourceType: JournalEntrySourceType.POS_SALE,
      referenceId: salesTransactionId,
      referenceNumber,
      description: `Posting otomatis penjualan POS ${referenceNumber}`,
      totalDebit: totals.totalDebit,
      totalCredit: totals.totalCredit,
      lines,
    };
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
        preferredCodes: ['1130', 'BANK', 'BANK-OPERASIONAL'],
        fallbackName: 'Bank Operasional',
        fallbackCode: '1130',
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

  private static async resolveSalesSettlementAccount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    settlementKind: SalesSettlementKind,
  ) {
    if (settlementKind === 'receivable') {
      return this.resolveReceivableAccount(tx, tenantId);
    }

    return this.resolveCashOnHandAccount(tx, tenantId);
  }

  private static async resolveCashOnHandAccount(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ) {
    return this.resolveAccount(tx, {
      tenantId,
      categoryCode: AccountCategoryType.ASSET,
      preferredNames: ['kas', 'cash', 'petty cash'],
      preferredCodes: ['1110', '1101', 'CASH', 'PETTY-CASH'],
      fallbackName: 'Kas',
      fallbackCode: '1110',
      normalBalance: AccountNormalBalance.DEBIT,
    });
  }

  private static async resolveReceivableAccount(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ) {
    return this.resolveAccount(tx, {
      tenantId,
      categoryCode: AccountCategoryType.ASSET,
      preferredNames: ['piutang usaha', 'piutang dagang', 'accounts receivable'],
      preferredCodes: ['1120', '1201', 'AR', 'PIUTANG'],
      fallbackName: 'Piutang Usaha',
      fallbackCode: '1120',
      normalBalance: AccountNormalBalance.DEBIT,
    });
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

  private static inferSalesSettlementKind(sale: {
    payment_method: string | null;
    payment_status: string | null;
    remaining_balance: Prisma.Decimal | null;
    outstanding_balance: Prisma.Decimal | null;
  }, forceReceivable = false): SalesSettlementKind {
    if (forceReceivable) {
      return 'receivable';
    }

    const hasOutstanding = this.toDecimal(sale.remaining_balance)
      .plus(this.toDecimal(sale.outstanding_balance))
      .gt(this.ZERO);

    if (hasOutstanding) {
      return 'receivable';
    }

    if (this.isKasbonLikePayment(sale.payment_method, sale.payment_status)) {
      return 'receivable';
    }

    return 'cash';
  }

  private static isKasbonLikePayment(
    paymentMethod: string | null,
    paymentStatus: string | null,
  ): boolean {
    const normalizedMethod = this.normalizeText(paymentMethod);
    const normalizedStatus = this.normalizeText(paymentStatus);

    if (normalizedMethod && KASBON_PAYMENT_KEYWORDS.some((word) => normalizedMethod.includes(word))) {
      return true;
    }

    if (normalizedStatus && KASBON_UNPAID_STATUSES.has(normalizedStatus)) {
      return true;
    }

    return false;
  }

  private static describeSalesSettlementKind(settlementKind: SalesSettlementKind) {
    return settlementKind === 'receivable' ? 'piutang usaha' : 'kas';
  }

  private static isIgnorableSalesPostingError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('tidak boleh diposting') ||
      message.includes('outstanding balance') ||
      message.includes('belum final') ||
      message.includes('tidak memiliki nilai total yang valid') ||
      message.includes('menghasilkan nilai pendapatan tidak valid')
    );
  }

  private static isIgnorableExpensePostingError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('tidak boleh diposting') ||
      message.includes('nominal tidak valid')
    );
  }

  private static isIgnorableKasbonPostingError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return message.includes('memiliki nominal tidak valid');
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