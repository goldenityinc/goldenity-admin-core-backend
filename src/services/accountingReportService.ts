import {
  AccountCategoryType,
  AccountNormalBalance,
  JournalEntrySourceType,
  Prisma,
} from '@prisma/client';
import prisma from '../config/database';
import AccountingPostingService from './accountingPostingService';

type AccountBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  category: AccountCategoryType;
  normalBalance: AccountNormalBalance;
  totalDebit: Prisma.Decimal;
  totalCredit: Prisma.Decimal;
};

type ReportAccountLine = {
  accountId: string;
  code: string;
  name: string;
  category: AccountCategoryType;
  normalBalance: AccountNormalBalance;
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

type ProfitAndLossReport = {
  tenantId: string;
  startDate: string;
  endDate: string;
  branchId: string | null;
  revenue: {
    total: number;
    accounts: ReportAccountLine[];
  };
  expense: {
    total: number;
    accounts: ReportAccountLine[];
  };
  netProfit: number;
};

type BalanceSheetReport = {
  tenantId: string;
  asOfDate: string;
  branchId: string | null;
  assets: {
    total: number;
    accounts: ReportAccountLine[];
  };
  liabilities: {
    total: number;
    accounts: ReportAccountLine[];
  };
  equity: {
    total: number;
    accounts: ReportAccountLine[];
    currentEarnings: number;
    reportedEquity: number;
  };
  isBalanced: boolean;
  balanceDelta: number;
};

const ZERO = new Prisma.Decimal(0);
const BALANCE_TOLERANCE = 0.005;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDecimal(value: Prisma.Decimal | number | null | undefined): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  if (value === null || value === undefined) {
    return ZERO;
  }
  return new Prisma.Decimal(value);
}

function normalizeDateBoundary(rawValue: Date | string, endOfDay = false): Date {
  if (rawValue instanceof Date) {
    return rawValue;
  }

  const trimmed = rawValue.trim();
  const hasExplicitTime = /t|\s\d{2}:\d{2}/i.test(trimmed);
  const normalized = hasExplicitTime
    ? trimmed
    : `${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Tanggal tidak valid: ${rawValue}`);
  }
  return parsed;
}

function calculateAccountBalance(row: AccountBalanceRow): Prisma.Decimal {
  const debit = toDecimal(row.totalDebit);
  const credit = toDecimal(row.totalCredit);
  return row.normalBalance === AccountNormalBalance.DEBIT
    ? debit.minus(credit)
    : credit.minus(debit);
}

function sortAccounts(lines: ReportAccountLine[]): ReportAccountLine[] {
  return [...lines].sort((left, right) => {
    if (left.code !== right.code) {
      return left.code.localeCompare(right.code);
    }
    return left.name.localeCompare(right.name);
  });
}

export class AccountingReportService {
  private static async ensureLedgerData(
    tenantId: string,
    startDate: Date | null,
    endDate: Date,
  ) {
    await AccountingPostingService.ensureSalesPostedForDateRange(
      tenantId,
      startDate,
      endDate,
    );
    await AccountingPostingService.ensureExpensesPostedForDateRange(
      tenantId,
      startDate,
      endDate,
    );
  }

  private static async loadAccountBalances(
    tenantId: string,
    startDate: Date | null,
    endDate: Date,
    categories: AccountCategoryType[],
    branchId: bigint | null,
  ): Promise<AccountBalanceRow[]> {
    const lines = await prisma.journalLine.findMany({
      where: {
        journalEntry: {
          tenantId,
          isPosted: true,
          entryDate: {
            ...(startDate ? { gte: startDate } : {}),
            lte: endDate,
          },
          ...(branchId !== null
            ? {
                sourceType: JournalEntrySourceType.POS_SALE,
                referenceId: {
                  in: (
                    await prisma.sales_records.findMany({
                      where: {
                        tenant_id: tenantId,
                        branch_id: branchId,
                        created_at: {
                          ...(startDate ? { gte: startDate } : {}),
                          lte: endDate,
                        },
                      },
                      select: {
                        id: true,
                      },
                    })
                  ).map((record) => record.id.toString()),
                },
              }
            : {}),
        },
        account: {
          category: {
            code: {
              in: categories,
            },
          },
        },
      },
      select: {
        debit: true,
        credit: true,
        account: {
          select: {
            id: true,
            code: true,
            name: true,
            normalBalance: true,
            category: {
              select: {
                code: true,
              },
            },
          },
        },
      },
    });

    const grouped = new Map<string, AccountBalanceRow>();
    for (const line of lines) {
      const key = line.account.id;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          accountId: line.account.id,
          code: line.account.code,
          name: line.account.name,
          category: line.account.category.code,
          normalBalance: line.account.normalBalance,
          totalDebit: toDecimal(line.debit),
          totalCredit: toDecimal(line.credit),
        });
        continue;
      }

      existing.totalDebit = existing.totalDebit.plus(toDecimal(line.debit));
      existing.totalCredit = existing.totalCredit.plus(toDecimal(line.credit));
    }

    return Array.from(grouped.values());
  }

  private static mapReportLines(rows: AccountBalanceRow[]): ReportAccountLine[] {
    return sortAccounts(
      rows.map((row) => ({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        category: row.category,
        normalBalance: row.normalBalance,
        totalDebit: roundCurrency(toDecimal(row.totalDebit).toNumber()),
        totalCredit: roundCurrency(toDecimal(row.totalCredit).toNumber()),
        balance: roundCurrency(calculateAccountBalance(row).toNumber()),
      })),
    );
  }

  private static sumBalances(lines: ReportAccountLine[]): number {
    return roundCurrency(lines.reduce((sum, line) => sum + line.balance, 0));
  }

  static async getProfitAndLossReport(
    tenantId: string,
    startDate: Date | string,
    endDate: Date | string,
    branchId: bigint | null = null,
  ): Promise<ProfitAndLossReport> {
    const rangeStart = normalizeDateBoundary(startDate, false);
    const rangeEnd = normalizeDateBoundary(endDate, true);

    if (rangeStart.getTime() > rangeEnd.getTime()) {
      throw new Error('startDate tidak boleh lebih besar dari endDate');
    }

    await this.ensureLedgerData(tenantId, rangeStart, rangeEnd);

    const rows = await this.loadAccountBalances(
      tenantId,
      rangeStart,
      rangeEnd,
      [AccountCategoryType.REVENUE, AccountCategoryType.EXPENSE],
      branchId,
    );

    const revenueAccounts = this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.REVENUE),
    );
    const expenseAccounts = this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.EXPENSE),
    );

    const totalRevenue = this.sumBalances(revenueAccounts);
    const totalExpense = this.sumBalances(expenseAccounts);
    const netProfit = roundCurrency(totalRevenue - totalExpense);

    return {
      tenantId,
      startDate: rangeStart.toISOString(),
      endDate: rangeEnd.toISOString(),
      branchId: branchId?.toString() ?? null,
      revenue: {
        total: totalRevenue,
        accounts: revenueAccounts,
      },
      expense: {
        total: totalExpense,
        accounts: expenseAccounts,
      },
      netProfit,
    };
  }

  static async getBalanceSheetReport(
    tenantId: string,
    asOfDate: Date | string,
    branchId: bigint | null = null,
  ): Promise<BalanceSheetReport> {
    const cutoffDate = normalizeDateBoundary(asOfDate, true);

    await this.ensureLedgerData(tenantId, null, cutoffDate);

    const rows = await this.loadAccountBalances(
      tenantId,
      null,
      cutoffDate,
      [
        AccountCategoryType.ASSET,
        AccountCategoryType.LIABILITY,
        AccountCategoryType.EQUITY,
        AccountCategoryType.REVENUE,
        AccountCategoryType.EXPENSE,
      ],
      branchId,
    );

    const assetAccounts = this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.ASSET),
    );
    const liabilityAccounts = this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.LIABILITY),
    );
    const equityAccounts = this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.EQUITY),
    );
    const revenueAccounts = this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.REVENUE),
    );
    const expenseAccounts = this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.EXPENSE),
    );

    const totalAssets = this.sumBalances(assetAccounts);
    const totalLiabilities = this.sumBalances(liabilityAccounts);
    const reportedEquity = this.sumBalances(equityAccounts);
    const currentEarnings = roundCurrency(
      this.sumBalances(revenueAccounts) - this.sumBalances(expenseAccounts),
    );
    const totalEquity = roundCurrency(reportedEquity + currentEarnings);
    const balanceDelta = roundCurrency(
      totalAssets - (totalLiabilities + totalEquity),
    );

    return {
      tenantId,
      asOfDate: cutoffDate.toISOString(),
      branchId: branchId?.toString() ?? null,
      assets: {
        total: totalAssets,
        accounts: assetAccounts,
      },
      liabilities: {
        total: totalLiabilities,
        accounts: liabilityAccounts,
      },
      equity: {
        total: totalEquity,
        accounts: equityAccounts,
        currentEarnings,
        reportedEquity,
      },
      isBalanced: Math.abs(balanceDelta) <= BALANCE_TOLERANCE,
      balanceDelta,
    };
  }
}

export default AccountingReportService;