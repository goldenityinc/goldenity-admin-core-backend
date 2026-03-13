import prisma from '../config/database';

type DashboardMetrics = {
  totalTenants: number;
  activeSubscriptions: number;
  subscriptionsBySolution: Array<{
    solutionId: string;
    solutionName: string;
    count: number;
  }>;
};

/**
 * Get dashboard metrics for Super Admin
 * @returns Dashboard metrics with tenant count, user count, product count, and system health
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const [totalTenants, activeSubscriptions, grouped] = await Promise.all([
    prisma.tenant.count(),
    prisma.appInstance.count({ where: { status: 'ACTIVE' } }),
    prisma.appInstance.groupBy({
      by: ['solutionId'],
      _count: {
        _all: true,
      },
    }),
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
  };
}

export const DashboardService = {
  getDashboardMetrics,
};
