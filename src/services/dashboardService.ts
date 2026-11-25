import prisma from '../config/database';
import { getPackageInfo } from '../constants/packageCatalog';
import { GLOBAL_FINANCE_MATRIX_TENANT_ID } from './clientPaymentService';

type AttentionItem = {
  appInstanceId: string;
  tenantId: string;
  tenantName: string;
  solutionName: string;
  packageLabel: string;
  endDate: string | null;
  reason: 'EXPIRED' | 'EXPIRING_SOON';
};

type DashboardMetrics = {
  totalTenants: number;
  activeSubscriptions: number;
  subscriptionsBySolution: Array<{
    solutionId: string;
    solutionName: string;
    count: number;
  }>;
  business: {
    /** Metrik utama: cabang aktif milik tenant yang punya minimal 1 langganan ACTIVE. */
    activePaidOutlets: number;
    activePayingTenants: number;
    /** Estimasi dari harga daftar × jumlah cabang aktif; langganan Custom tidak dihitung. */
    estimatedMrr: number;
    customSubscriptions: number;
    packageBreakdown: Array<{ packageLabel: string; subscriptions: number; outlets: number; estimatedMrr: number }>;
    expiringSoonCount: number;
    expiredButActiveCount: number;
    attention: AttentionItem[];
    payments: {
      periodMonth: number;
      periodYear: number;
      paidAmount: number;
      unpaidCount: number;
      unpaidAmount: number;
    };
    leads: {
      total: number;
      newThisWeek: number;
      dueFollowUps: number;
      byStage: Array<{ stage: string; count: number }>;
    };
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function getBusinessMetrics(): Promise<DashboardMetrics['business']> {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * DAY_MS);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const periodMonth = now.getMonth() + 1;
  const periodYear = now.getFullYear();

  const activeInstances = await prisma.appInstance.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      tier: true,
      endDate: true,
      tenantId: true,
      tenant: { select: { id: true, name: true, isActive: true } },
      solution: { select: { code: true, name: true } },
    },
  });

  const payingInstances = activeInstances.filter((instance) => instance.tenant.isActive);
  const tenantIds = Array.from(new Set(payingInstances.map((instance) => instance.tenantId)));

  const branchCounts = tenantIds.length
    ? await prisma.branch.groupBy({
        by: ['tenantId'],
        where: { tenantId: { in: tenantIds }, isActive: true },
        _count: { _all: true },
      })
    : [];
  // Tenant tanpa cabang tercatat tetap dihitung 1 outlet.
  const outletsByTenant = new Map<string, number>(tenantIds.map((id) => [id, 1]));
  for (const row of branchCounts) {
    outletsByTenant.set(row.tenantId, Math.max(1, row._count._all));
  }

  let estimatedMrr = 0;
  let customSubscriptions = 0;
  const breakdown = new Map<string, { packageLabel: string; subscriptions: number; outlets: number; estimatedMrr: number }>();
  const attention: AttentionItem[] = [];
  let expiringSoonCount = 0;
  let expiredButActiveCount = 0;

  for (const instance of payingInstances) {
    const info = getPackageInfo(instance.solution.code, instance.tier);
    const outlets = outletsByTenant.get(instance.tenantId) ?? 1;
    const mrr = info.monthlyPricePerOutlet ? info.monthlyPricePerOutlet * outlets : 0;
    if (info.monthlyPricePerOutlet === null) customSubscriptions += 1;
    estimatedMrr += mrr;

    const row = breakdown.get(info.label) ?? { packageLabel: info.label, subscriptions: 0, outlets: 0, estimatedMrr: 0 };
    row.subscriptions += 1;
    row.outlets += outlets;
    row.estimatedMrr += mrr;
    breakdown.set(info.label, row);

    if (instance.endDate) {
      const reason = instance.endDate < now ? 'EXPIRED' : instance.endDate <= in30Days ? 'EXPIRING_SOON' : null;
      if (reason === 'EXPIRED') expiredButActiveCount += 1;
      if (reason === 'EXPIRING_SOON') expiringSoonCount += 1;
      if (reason) {
        attention.push({
          appInstanceId: instance.id,
          tenantId: instance.tenantId,
          tenantName: instance.tenant.name,
          solutionName: instance.solution.name,
          packageLabel: info.label,
          endDate: instance.endDate.toISOString(),
          reason,
        });
      }
    }
  }

  attention.sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''));

  // Outlet unik per tenant (satu tenant bisa punya POS + ERP pada cabang yang sama).
  const activePaidOutlets = tenantIds.reduce((sum, id) => sum + (outletsByTenant.get(id) ?? 1), 0);

  const [paymentGroups, leadTotal, leadNewThisWeek, leadDue, leadByStage] = await Promise.all([
    prisma.client_payment_records.groupBy({
      by: ['status'],
      where: { tenant_id: GLOBAL_FINANCE_MATRIX_TENANT_ID, period_month: periodMonth, period_year: periodYear },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.lead.count({ where: { nextFollowUpAt: { lte: now }, stage: { notIn: ['WON', 'LOST'] } } }),
    prisma.lead.groupBy({ by: ['stage'], _count: { _all: true } }),
  ]);

  const paid = paymentGroups.find((row) => row.status === 'Paid');
  const unpaid = paymentGroups.find((row) => row.status === 'NotPaid');

  return {
    activePaidOutlets,
    activePayingTenants: tenantIds.length,
    estimatedMrr,
    customSubscriptions,
    packageBreakdown: Array.from(breakdown.values()).sort((a, b) => b.estimatedMrr - a.estimatedMrr),
    expiringSoonCount,
    expiredButActiveCount,
    attention: attention.slice(0, 10),
    payments: {
      periodMonth,
      periodYear,
      paidAmount: Number(paid?._sum.amount ?? 0),
      unpaidCount: unpaid?._count._all ?? 0,
      unpaidAmount: Number(unpaid?._sum.amount ?? 0),
    },
    leads: {
      total: leadTotal,
      newThisWeek: leadNewThisWeek,
      dueFollowUps: leadDue,
      byStage: leadByStage.map((row) => ({ stage: row.stage, count: row._count._all })),
    },
  };
}

/**
 * Get dashboard metrics for Super Admin
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [totalTenants, activeSubscriptions, grouped, business] = await Promise.all([
    prisma.tenant.count(),
    prisma.appInstance.count({ where: { status: 'ACTIVE' } }),
    prisma.appInstance.groupBy({
      by: ['solutionId'],
      _count: {
        _all: true,
      },
    }),
    getBusinessMetrics(),
  ]);

  const solutionIds = grouped.map((item) => item.solutionId);
  const solutions = solutionIds.length
    ? await prisma.solution.findMany({
        where: { id: { in: solutionIds } },
        select: { id: true, name: true },
      })
    : [];

  const solutionNameById = new Map(solutions.map((solution) => [solution.id, solution.name]));

  const subscriptionsBySolution = grouped
    .map((item) => ({
      solutionId: item.solutionId,
      solutionName: solutionNameById.get(item.solutionId) ?? 'Unknown Solution',
      count: item._count._all,
    }))
    .sort((left, right) => right.count - left.count);

  return {
    totalTenants,
    activeSubscriptions,
    subscriptionsBySolution,
    business,
  };
}

export const DashboardService = {
  getDashboardMetrics,
};
