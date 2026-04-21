import { Prisma, type ModuleAssignmentSource } from '@prisma/client';
import prisma from '../config/database';
import { getPosModuleCatalogMap, resolveLegacyModuleAssignments } from '../constants/moduleCatalog';
import { AppError } from '../utils/AppError';

type AppInstanceModuleAssignment = {
  source: ModuleAssignmentSource;
  config?: Record<string, unknown>;
  limits?: Record<string, unknown>;
};

export type AppInstanceModuleCatalogItem = {
  key: string;
  name: string;
  description: string | null;
  status: string;
};

type AppInstanceWritePayload = {
  tenantId: string;
  solutionId: string;
  tier: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
  moduleKeys?: string[];
  addons?: string[];
  syncMode?: (typeof AppInstanceService.SyncModeValues)[number];
  status?: 'ACTIVE' | 'SUSPENDED';
  dbConnectionString?: string | null;
  appUrl?: string | null;
  endDate?: string | null;
};

type AppInstanceUpdatePayload = {
  tier?: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
  moduleKeys?: string[];
  addons?: string[];
  syncMode?: (typeof AppInstanceService.SyncModeValues)[number];
  status?: 'ACTIVE' | 'SUSPENDED';
  dbConnectionString?: string | null;
  appUrl?: string | null;
  endDate?: string | null;
};

const APP_INSTANCE_INCLUDE = {
  tenant: { select: { id: true, name: true, slug: true } },
  solution: { select: { id: true, name: true, code: true } },
  modules: {
    where: { isEnabled: true },
    include: {
      moduleDefinition: {
        select: {
          moduleKey: true,
        },
      },
    },
  },
} satisfies Prisma.AppInstanceInclude;

function toNullableInputJson(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}

function normalizeModuleKeys(moduleKeys: string[] | undefined): string[] {
  if (!Array.isArray(moduleKeys)) {
    return [];
  }

  return [...new Set(moduleKeys.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function mergeRecord(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

function attachModuleKeys<T extends { modules?: Array<{ moduleDefinition: { moduleKey: string } }> }>(
  appInstance: T,
): Omit<T, 'modules'> & { moduleKeys: string[] } {
  const { modules, ...rest } = appInstance;
  return {
    ...rest,
    moduleKeys: (modules ?? []).map((item) => item.moduleDefinition.moduleKey),
  };
}

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

  static resolveModuleKeysWithDependencies(moduleKeys: string[]): string[] {
    const catalog = getPosModuleCatalogMap();
    const resolved = new Set<string>();
    const stack = [...moduleKeys];

    while (stack.length > 0) {
      const moduleKey = stack.pop();
      if (!moduleKey || resolved.has(moduleKey)) {
        continue;
      }

      resolved.add(moduleKey);
      const catalogEntry = catalog.get(moduleKey);
      for (const dependency of catalogEntry?.dependencies ?? []) {
        if (!resolved.has(dependency)) {
          stack.push(dependency);
        }
      }
    }

    return [...resolved];
  }

  static async listModuleCatalog(): Promise<AppInstanceModuleCatalogItem[]> {
    const items = await prisma.moduleDefinition.findMany({
      select: {
        moduleKey: true,
        displayName: true,
        description: true,
        status: true,
      },
      orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
    });

    return items.map((item) => ({
      key: item.moduleKey,
      name: item.displayName,
      description: item.description,
      status: item.status,
    }));
  }

  static buildModuleAssignments(input: {
    tier?: string | null;
    addons?: string[];
    moduleKeys?: string[];
  }): Record<string, AppInstanceModuleAssignment> {
    const catalog = getPosModuleCatalogMap();
    const assignments = resolveLegacyModuleAssignments({
      tier: input.tier,
      addons: input.addons,
    }) as Record<string, AppInstanceModuleAssignment>;

    const resolvedModuleKeys = AppInstanceService.resolveModuleKeysWithDependencies(
      normalizeModuleKeys(input.moduleKeys),
    );

    for (const moduleKey of resolvedModuleKeys) {
      const catalogEntry = catalog.get(moduleKey);
      const current = assignments[moduleKey];

      assignments[moduleKey] = {
        source: current?.source ?? 'MANUAL_OVERRIDE',
        config: mergeRecord(catalogEntry?.defaultConfig, current?.config),
        limits: current?.limits,
      };
    }

    return assignments;
  }

  static async syncAppInstanceModules(
    tx: Prisma.TransactionClient,
    appInstanceId: string,
    input: {
      tier?: string | null;
      addons?: string[];
      moduleKeys?: string[];
    },
  ): Promise<void> {
    const assignments = AppInstanceService.buildModuleAssignments(input);
    const moduleKeys = Object.keys(assignments);

    const definitions = moduleKeys.length
      ? await tx.moduleDefinition.findMany({
          where: {
            moduleKey: {
              in: moduleKeys,
            },
          },
          select: {
            id: true,
            moduleKey: true,
          },
        })
      : [];

    const definitionMap = new Map(definitions.map((item) => [item.moduleKey, item.id]));
    const missing = moduleKeys.filter((moduleKey) => !definitionMap.has(moduleKey));
    if (missing.length > 0) {
      throw new AppError(`Unknown module keys: ${missing.join(', ')}`, 400);
    }

    await tx.appInstanceModule.deleteMany({
      where: { appInstanceId },
    });

    if (moduleKeys.length === 0) {
      return;
    }

    const activatedAt = new Date();
    await tx.appInstanceModule.createMany({
      data: moduleKeys.map((moduleKey) => ({
        appInstanceId,
        moduleDefinitionId: definitionMap.get(moduleKey)!,
        isEnabled: true,
        source: assignments[moduleKey].source,
        activatedAt,
        config: toNullableInputJson(assignments[moduleKey].config),
        limits: toNullableInputJson(assignments[moduleKey].limits),
      })),
    });
  }

  static async create(data: AppInstanceWritePayload) {
    const created = await prisma.$transaction(async (tx) => {
      const appInstance = await tx.appInstance.create({
        data: {
          tenantId: data.tenantId,
          solutionId: data.solutionId,
          tier: data.tier,
          addons: data.addons ?? [],
          ...(data.syncMode !== undefined ? { syncMode: data.syncMode } : {}),
          status: data.status ?? 'ACTIVE',
          dbConnectionString: null,
          appUrl: data.appUrl,
          ...(data.endDate !== undefined
            ? { endDate: AppInstanceService.parseEndDateInput(data.endDate) }
            : {}),
        },
        include: APP_INSTANCE_INCLUDE,
      });

      await AppInstanceService.syncAppInstanceModules(tx, appInstance.id, {
        tier: data.tier,
        addons: data.addons,
        moduleKeys: data.moduleKeys,
      });

      return tx.appInstance.findUniqueOrThrow({
        where: { id: appInstance.id },
        include: APP_INSTANCE_INCLUDE,
      });
    });

    return attachModuleKeys(created);
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
        include: APP_INSTANCE_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.appInstance.count({ where }),
    ]);

    return {
      items: items.map((item) => attachModuleKeys(item)),
      meta: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / options.limit)),
      },
    };
  }

  static async getById(id: string) {
    const item = await prisma.appInstance.findUnique({
      where: { id },
      include: APP_INSTANCE_INCLUDE,
    });

    return item ? attachModuleKeys(item) : null;
  }

  static async update(
    id: string,
    data: AppInstanceUpdatePayload
  ) {
    const current = await prisma.appInstance.findUnique({
      where: { id },
      select: {
        tier: true,
        addons: true,
      },
    });

    if (!current) {
      throw new AppError('App instance not found', 404);
    }

    const {
      endDate,
      syncMode,
      dbConnectionString: _ignoredDbConnectionString,
      moduleKeys,
      ...restData
    } = data;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.appInstance.update({
        where: { id },
        data: {
          ...restData,
          dbConnectionString: null,
          ...(syncMode !== undefined ? { syncMode } : {}),
          ...(endDate !== undefined ? { endDate: AppInstanceService.parseEndDateInput(endDate) } : {}),
        },
      });

      await AppInstanceService.syncAppInstanceModules(tx, id, {
        tier: data.tier ?? current.tier,
        addons: data.addons ?? current.addons,
        moduleKeys,
      });

      return tx.appInstance.findUniqueOrThrow({
        where: { id },
        include: APP_INSTANCE_INCLUDE,
      });
    });

    return attachModuleKeys(updated);
  }

  static async remove(id: string) {
    return prisma.appInstance.delete({
      where: { id },
    });
  }
}
