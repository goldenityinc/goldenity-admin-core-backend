import {
  AccountCategoryType,
  AccountNormalBalance,
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

type PayrollEmployeeLine = {
  userId: string;
  name: string;
  employeeType: string;
  baseSalary: number;
};

type PayrollMechanicCommissionLine = {
  mechanicId: string | null;
  mechanicName: string;
  commission: number;
};

type PayrollReport = {
  tenantId: string;
  month: number;
  year: number;
  branchId: string | null;
  periodStart: string;
  periodEnd: string;
  totals: {
    baseSalary: number;
    mechanicCommission: number;
    payrollTotal: number;
  };
  employees: PayrollEmployeeLine[];
  mechanicCommissions: PayrollMechanicCommissionLine[];
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
    await AccountingPostingService.ensureKasbonPaymentsPostedForDateRange(
      tenantId,
      startDate,
      endDate,
    );
  }

  private static async ensureEssentialAssetAccounts(
    tenantId: string,
    assetAccounts: ReportAccountLine[],
  ): Promise<ReportAccountLine[]> {
    const requiredAssetAccounts = await prisma.chartOfAccount.findMany({
      where: {
        tenantId,
        isActive: true,
        category: {
          code: AccountCategoryType.ASSET,
        },
        OR: [
          { code: '1110' },
          { code: '1120' },
          {
            name: {
              contains: 'piutang',
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        normalBalance: true,
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });

    if (requiredAssetAccounts.length === 0) {
      return assetAccounts;
    }

    const existingIds = new Set(assetAccounts.map((line) => line.accountId));
    const ensured = [...assetAccounts];

    for (const account of requiredAssetAccounts) {
      if (existingIds.has(account.id)) {
        continue;
      }

      ensured.push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        category: AccountCategoryType.ASSET,
        normalBalance: account.normalBalance,
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
      });
    }

    return sortAccounts(ensured);
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
          ...(branchId !== null ? { branchId } : {}),
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

    const assetAccounts = await this.ensureEssentialAssetAccounts(
      tenantId,
      this.mapReportLines(
      rows.filter((row) => row.category === AccountCategoryType.ASSET),
      ),
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

  static async getPayrollReport(
    tenantId: string,
    month: number,
    year: number,
    branchId: bigint | null = null,
  ): Promise<PayrollReport> {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error('month harus 1-12');
    }

    if (!Number.isInteger(year) || year < 2000 || year > 3000) {
      throw new Error('year harus valid');
    }

    const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const [employees, mechanicRows] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          employeeType: true,
          baseSalary: true,
        },
        orderBy: {
          name: 'asc',
        },
      }),
      prisma.sales_records.findMany({
        where: {
          tenant_id: tenantId,
          ...(branchId !== null ? { branch_id: branchId } : {}),
          created_at: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
        select: {
          mechanic_id: true,
          mechanic_name: true,
          mechanic_commission: true,
        },
      }),
    ]);

    const employeeLines = employees.map((employee) => ({
      userId: employee.id,
      name: employee.name,
      employeeType: employee.employeeType,
      baseSalary: roundCurrency(toDecimal(employee.baseSalary).toNumber()),
    }));

    const commissionMap = new Map<string, PayrollMechanicCommissionLine>();

    for (const row of mechanicRows) {
      const commissionValue = roundCurrency(toDecimal(row.mechanic_commission).toNumber());
      if (commissionValue <= 0) {
        continue;
      }

      const mechanicId = row.mechanic_id?.trim() || null;
      const mechanicName = row.mechanic_name?.trim() || 'Unknown Mechanic';
      const key = `${mechanicId ?? 'null'}:${mechanicName}`;
      const existing = commissionMap.get(key);

      if (!existing) {
        commissionMap.set(key, {
          mechanicId,
          mechanicName,
          commission: commissionValue,
        });
      } else {
        existing.commission = roundCurrency(existing.commission + commissionValue);
      }
    }

    const mechanicCommissions = Array.from(commissionMap.values()).sort((a, b) =>
      a.mechanicName.localeCompare(b.mechanicName),
    );

    const totalBaseSalary = roundCurrency(
      employeeLines.reduce((sum, line) => sum + line.baseSalary, 0),
    );
    const totalMechanicCommission = roundCurrency(
      mechanicCommissions.reduce((sum, line) => sum + line.commission, 0),
    );

    return {
      tenantId,
      month,
      year,
      branchId: branchId?.toString() ?? null,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totals: {
        baseSalary: totalBaseSalary,
        mechanicCommission: totalMechanicCommission,
        payrollTotal: roundCurrency(totalBaseSalary + totalMechanicCommission),
      },
      employees: employeeLines,
      mechanicCommissions,
    };
  }
}

export default AccountingReportService;