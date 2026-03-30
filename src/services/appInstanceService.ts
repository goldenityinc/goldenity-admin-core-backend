import prisma from '../config/database';

export class AppInstanceService {
  static readonly SyncModeValues = ['CLOUD_FIRST', 'LOCAL_FIRST', 'LOCAL_SERVER'] as const;

  static parseEndDateInput(input: string | null | undefined): Date | null | undefined {
    if (input === undefined) return undefined;
    if (input === null) return null;
    const raw = input.trim();
    if (!raw) return null;

    // Accept YYYY-MM-DD (treat as end of day UTC).
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    }

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  static async create(data: {
    tenantId: string;
    solutionId: string;
    tier: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
    addons?: string[];
    syncMode?: (typeof AppInstanceService.SyncModeValues)[number];
    status?: 'ACTIVE' | 'SUSPENDED';
    dbConnectionString?: string | null;
    appUrl?: string | null;
    endDate?: string | null;
  }) {
    return prisma.appInstance.create({
      data: {
        tenantId: data.tenantId,
        solutionId: data.solutionId,
        tier: data.tier,
        addons: data.addons ?? [],
        ...(data.syncMode !== undefined ? { syncMode: data.syncMode } : {}),
        status: data.status ?? 'ACTIVE',
        dbConnectionString: null,
        appUrl: data.appUrl,
        ...(data.endDate !== undefined ? { endDate: AppInstanceService.parseEndDateInput(data.endDate) } : {}),
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });
  }

  static async list(options: {
    page: number;
    limit: number;
    tenantId?: string;
    solutionId?: string;
    status?: 'ACTIVE' | 'SUSPENDED';
    tier?: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
  }) {
    const skip = (options.page - 1) * options.limit;

    const where = {
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(options.solutionId ? { solutionId: options.solutionId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.tier ? { tier: options.tier } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.appInstance.findMany({
        where,
        skip,
        take: options.limit,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          solution: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.appInstance.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / options.limit)),
      },
    };
  }

  static async getById(id: string) {
    return prisma.appInstance.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });
  }

  static async update(
    id: string,
    data: {
      tier?: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
      addons?: string[];
      syncMode?: (typeof AppInstanceService.SyncModeValues)[number];
      status?: 'ACTIVE' | 'SUSPENDED';
      dbConnectionString?: string | null;
      appUrl?: string | null;
      endDate?: string | null;
    }
  ) {
    const { endDate, syncMode, dbConnectionString: _ignoredDbConnectionString, ...restData } = data;

    return prisma.appInstance.update({
      where: { id },
      data: {
        ...restData,
        dbConnectionString: null,
        ...(syncMode !== undefined ? { syncMode } : {}),
        ...(endDate !== undefined ? { endDate: AppInstanceService.parseEndDateInput(endDate) } : {}),
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });
  }

  static async remove(id: string) {
    return prisma.appInstance.delete({
      where: { id },
    });
  }
}
