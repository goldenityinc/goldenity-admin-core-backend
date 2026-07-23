import {
  AppRole,
  Prisma,
  UserRole,
  type AppModule,
  type BusinessCategory,
  type ModuleAssignmentSource,
} from '@prisma/client';
import prisma from '../config/database';
import { getPosModuleCatalogMap, resolveLegacyModuleAssignments } from '../constants/moduleCatalog';
import { getBusinessCategoryDefaultModuleKeys } from '../constants/businessCategory';
import { AppError } from '../utils/AppError';
import { hashPassword } from '../utils/password';

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

type SolutionModuleCatalogType = 'POS' | 'ERP' | 'SCHOOL_ERP' | 'OTHER';

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
  adminEmail?: string | null;
  adminPassword?: string | null;
  adminName?: string | null;
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
  adminEmail?: string | null;
  adminPassword?: string | null;
  adminName?: string | null;
  endDate?: string | null;
};

const APP_INSTANCE_INCLUDE = {
  tenant: { select: { id: true, name: true, slug: true, businessCategory: true } },
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

function toModuleDisplayName(moduleKey: string): string {
  const normalized = moduleKey.trim();
  if (!normalized) {
    return 'Unknown Module';
  }

  return normalized
    .replace(/^module_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
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
  const { modules, ...rest } = appInstance as T & { adminPassword?: string | null };
  return {
    ...rest,
    adminPassword: undefined,
    appUrl: resolveEffectiveAppUrl(rest as AppInstanceUrlContext),
    moduleKeys: (modules ?? []).map((item) => item.moduleDefinition.moduleKey),
  };
}

type AppInstanceUrlContext = {
  appUrl?: string | null;
  tenant?: { slug?: string | null };
  solution?: { code?: string | null };
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeOrigin(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function resolveErpWebOrigin(): string {
  const explicit =
    process.env.ERP_WEB_ORIGIN?.trim() ||
    process.env.ERP_WEB_URL?.trim() ||
    process.env.ERP_APP_URL?.trim();

  if (explicit) {
    return normalizeOrigin(explicit);
  }

  const apiBaseUrl =
    process.env.ERP_API_BASE_URL?.trim() ||
    process.env.ERP_API_URL?.trim();

  if (!apiBaseUrl) {
    return '';
  }

  try {
    return normalizeOrigin(new URL(apiBaseUrl).origin);
  } catch {
    return normalizeOrigin(apiBaseUrl.replace(/\/api(?:\/v\d+)?\/?$/i, ''));
  }
}

function resolveConfiguredSolutionOrigin(solutionCode: string | null | undefined): string {
  const normalizedCode = solutionCode?.trim().toUpperCase() ?? '';

  if (normalizedCode === 'ERP') {
    return resolveErpWebOrigin();
  }

  if (normalizedCode === 'POS') {
    return normalizeOrigin(
      process.env.POS_WEB_ORIGIN?.trim() ||
        process.env.POS_WEB_URL?.trim() ||
        process.env.POS_URL?.trim(),
    );
  }

  if (normalizedCode === 'CLINIC' || normalizedCode === 'MEDICAL') {
    return normalizeOrigin(
      process.env.CLINIC_WEB_ORIGIN?.trim() ||
        process.env.CLINIC_WEB_URL?.trim() ||
        process.env.MEDICAL_WEB_ORIGIN?.trim() ||
        process.env.MEDICAL_WEB_URL?.trim(),
    );
  }

  if (normalizedCode === 'SCHOOL_ERP') {
    return normalizeOrigin(
      process.env.SCHOOL_ERP_WEB_ORIGIN?.trim() ||
        process.env.SCHOOL_ERP_WEB_URL?.trim() ||
        process.env.SCHOOL_ERP_APP_URL?.trim(),
    );
  }

  return '';
}

function buildSolutionLoginUrl(
  origin: string,
  solutionCode: string | null | undefined,
  tenantSlug: string | null | undefined,
): string {
  const normalizedCode = solutionCode?.trim().toUpperCase() ?? '';
  const slug = tenantSlug?.trim() ?? '';

  if (!slug) {
    return origin;
  }

  if (normalizedCode === 'ERP') {
    return `${origin}/erp/${encodeURIComponent(slug)}/login`;
  }

  if (normalizedCode === 'POS' || normalizedCode === 'CLINIC' || normalizedCode === 'MEDICAL') {
    return `${origin}/t/${encodeURIComponent(slug)}/login`;
  }

  if (normalizedCode === 'SCHOOL_ERP') {
    return `${origin}/login?tenantSlug=${encodeURIComponent(slug)}`;
  }

  return origin;
}

function resolveEffectiveAppUrl(input: AppInstanceUrlContext): string | null {
  const explicitAppUrl = normalizeOptionalText(input.appUrl);
  if (explicitAppUrl) {
    return explicitAppUrl;
  }

  const origin = resolveConfiguredSolutionOrigin(input.solution?.code);
  if (!origin) {
    return null;
  }

  return buildSolutionLoginUrl(origin, input.solution?.code, input.tenant?.slug);
}

function resolveSolutionModuleCatalogType(input: {
  code?: string | null;
  name?: string | null;
}): SolutionModuleCatalogType {
  const normalizedCode = input.code?.trim().toUpperCase();
  if (normalizedCode === 'POS') {
    return 'POS';
  }

  if (normalizedCode === 'ERP') {
    return 'ERP';
  }

  if (normalizedCode === 'SCHOOL_ERP') {
    return 'SCHOOL_ERP';
  }

  const normalizedName = input.name?.trim().toUpperCase() ?? '';
  if (normalizedName.includes('POS')) {
    return 'POS';
  }

  if (normalizedName.includes('ERP')) {
    return 'ERP';
  }

  if (normalizedName.includes('SCHOOL')) {
    return 'SCHOOL_ERP';
  }

  return 'OTHER';
}

async function ensureSchoolErpAdminAccess(
  tx: Prisma.TransactionClient,
  input: {
    appInstanceId: string;
    tenantId: string;
    tenantName: string;
    adminEmail?: string | null;
    adminPassword?: string | null;
    adminName?: string | null;
  },
): Promise<void> {
  const adminEmail = normalizeOptionalText(input.adminEmail)?.toLowerCase() ?? null;
  if (!adminEmail) {
    return;
  }

  const adminPassword = normalizeOptionalText(input.adminPassword);
  const adminName = normalizeOptionalText(input.adminName) ?? `${input.tenantName} Admin`;

  const existingUser = await tx.user.findFirst({
    where: { email: adminEmail },
    select: {
      id: true,
      email: true,
      tenantId: true,
      role: true,
      allowedSolutions: true,
    },
  });

  if (existingUser && existingUser.tenantId !== input.tenantId) {
    throw new AppError(
      `Email admin SCHOOL_ERP (${adminEmail}) sudah dipakai tenant lain. Gunakan email admin yang berbeda.`,
      409,
    );
  }

  if (!existingUser && !adminPassword) {
    throw new AppError(
      'Password admin SCHOOL_ERP wajib diisi untuk membuat akun login pertama.',
      400,
    );
  }

  const allowedSolutions = Array.from(
    new Set([...(existingUser?.allowedSolutions ?? []), 'SCHOOL_ERP']),
  );
  const passwordHash = adminPassword ? await hashPassword(adminPassword) : undefined;

  const user = existingUser
    ? await tx.user.update({
        where: { id: existingUser.id },
        data: {
          name: adminName,
          username: adminEmail,
          tenantId: input.tenantId,
          role: existingUser.role ?? UserRole.TENANT_ADMIN,
          allowedSolutions,
          isActive: true,
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: { id: true },
      })
    : await tx.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          username: adminEmail,
          tenantId: input.tenantId,
          role: UserRole.TENANT_ADMIN,
          allowedSolutions,
          isActive: true,
          passwordHash: passwordHash as string,
        },
        select: { id: true },
      });

  await tx.userAppAccess.upsert({
    where: {
      userId_appInstanceId: {
        userId: user.id,
        appInstanceId: input.appInstanceId,
      },
    },
    create: {
      userId: user.id,
      appInstanceId: input.appInstanceId,
      role: AppRole.ADMIN,
      isActive: true,
    },
    update: {
      role: AppRole.ADMIN,
      isActive: true,
    },
  });
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

  static async listModuleCatalog(options?: {
    solutionId?: string;
    solutionCode?: string;
  }): Promise<AppInstanceModuleCatalogItem[]> {
    if (options?.solutionCode) {
      const catalogType = resolveSolutionModuleCatalogType({ code: options.solutionCode });
      if (catalogType === 'POS') {
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

    if (options?.solutionId) {
      const solution = await prisma.solution.findUnique({
        where: { id: options.solutionId },
        select: { code: true, name: true },
      });

      if (!solution) {
        throw new AppError('Solution not found', 404);
      }

    }

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
    solutionType: SolutionModuleCatalogType;
    tier?: string | null;
    addons?: string[];
    moduleKeys?: string[];
    businessCategory?: BusinessCategory | null;
  }): Record<string, AppInstanceModuleAssignment> {
    if (input.solutionType !== 'POS') {
      return Object.fromEntries(
        normalizeModuleKeys(input.moduleKeys).map((moduleKey) => [
          moduleKey,
          {
            source: 'MANUAL_OVERRIDE' as const,
          },
        ]),
      );
    }

    const catalog = getPosModuleCatalogMap();
    const hasExplicitModuleKeys = Array.isArray(input.moduleKeys);
    const assignments = (hasExplicitModuleKeys
      ? {}
      : resolveLegacyModuleAssignments({
          tier: input.tier,
          addons: input.addons,
        })) as Record<string, AppInstanceModuleAssignment>;

    const categoryDefaultModuleKeys = getBusinessCategoryDefaultModuleKeys(
      input.businessCategory,
    );
    const resolvedModuleKeys = AppInstanceService.resolveModuleKeysWithDependencies(
      normalizeModuleKeys([
        ...Object.keys(assignments),
        ...(input.moduleKeys ?? []),
        ...categoryDefaultModuleKeys,
      ]),
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
      solutionType: SolutionModuleCatalogType;
      tier?: string | null;
      addons?: string[];
      moduleKeys?: string[];
      businessCategory?: BusinessCategory | null;
    },
  ): Promise<void> {
    const assignments = AppInstanceService.buildModuleAssignments(input);
    const moduleKeys = Object.keys(assignments);

    let definitions = moduleKeys.length
      ? await tx.moduleDefinition.findMany({
          where: {
            moduleKey: {
              in: moduleKeys as AppModule[],
            },
          },
          select: {
            id: true,
            moduleKey: true,
          },
        })
      : [];

    let definitionMap = new Map(definitions.map((item) => [item.moduleKey as string, item.id]));
    const missing = moduleKeys.filter((moduleKey) => !definitionMap.has(moduleKey));
    if (missing.length > 0) {
      const catalogMap = getPosModuleCatalogMap();
      const missingCatalogEntries = missing
        .map((moduleKey) => catalogMap.get(moduleKey))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

      const genericMissingEntries = missing
        .filter((moduleKey) => !catalogMap.has(moduleKey))
        .map((moduleKey) => ({
          moduleKey,
          displayName: toModuleDisplayName(moduleKey),
          category: input.solutionType === 'SCHOOL_ERP' ? 'school_erp' : 'general',
          description: `${toModuleDisplayName(moduleKey)} module`,
          isCore: false,
          status: 'ACTIVE' as const,
          dependencies: [] as string[],
          defaultConfig: undefined,
        }));

      if (missingCatalogEntries.length > 0 || genericMissingEntries.length > 0) {
        await tx.moduleDefinition.createMany({
          data: [...missingCatalogEntries, ...genericMissingEntries].map((entry) => ({
            moduleKey: entry.moduleKey as AppModule,
            displayName: entry.displayName,
            category: entry.category,
            description: entry.description,
            isCore: entry.isCore ?? false,
            status: 'ACTIVE',
            dependencies: entry.dependencies ?? [],
            defaultConfig: toNullableInputJson(entry.defaultConfig),
          })),
          skipDuplicates: true,
        });

        definitions = await tx.moduleDefinition.findMany({
          where: {
            moduleKey: {
              in: moduleKeys as AppModule[],
            },
          },
          select: {
            id: true,
            moduleKey: true,
          },
        });
        definitionMap = new Map(definitions.map((item) => [item.moduleKey as string, item.id]));
      }

      const unresolved = moduleKeys.filter((moduleKey) => !definitionMap.has(moduleKey));
      if (unresolved.length > 0) {
        throw new AppError(`Unknown module keys: ${unresolved.join(', ')}`, 400);
      }
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
      const [tenant, solution] = await Promise.all([
        tx.tenant.findUnique({
          where: { id: data.tenantId },
          select: { id: true, name: true, slug: true, businessCategory: true },
        }),
        tx.solution.findUnique({
          where: { id: data.solutionId },
          select: { id: true, name: true, code: true },
        }),
      ]);

      if (!tenant) {
        throw new AppError('Tenant tidak ditemukan', 404);
      }

      if (!solution) {
        throw new AppError('Solution tidak ditemukan', 404);
      }

      const solutionType = resolveSolutionModuleCatalogType(solution);
      const resolvedAppUrl = resolveEffectiveAppUrl({
        appUrl: data.appUrl,
        tenant,
        solution,
      });

      const appInstance = await tx.appInstance.create({
        data: {
          tenantId: data.tenantId,
          solutionId: data.solutionId,
          tier: data.tier,
          addons: data.addons ?? [],
          ...(data.syncMode !== undefined ? { syncMode: data.syncMode } : {}),
          status: data.status ?? 'ACTIVE',
          dbConnectionString: null,
          appUrl: resolvedAppUrl,
          ...(data.adminEmail !== undefined ? { adminEmail: data.adminEmail } : {}),
          ...(data.adminPassword !== undefined ? { adminPassword: data.adminPassword } : {}),
          ...(data.adminName !== undefined ? { adminName: data.adminName } : {}),
          ...(data.endDate !== undefined
            ? { endDate: AppInstanceService.parseEndDateInput(data.endDate) }
            : {}),
        },
        include: APP_INSTANCE_INCLUDE,
      });

      await AppInstanceService.syncAppInstanceModules(tx, appInstance.id, {
        solutionType,
        tier: data.tier,
        addons: data.addons,
        moduleKeys: data.moduleKeys,
        businessCategory: tenant.businessCategory,
      });

      if (solutionType === 'SCHOOL_ERP') {
        await ensureSchoolErpAdminAccess(tx, {
          appInstanceId: appInstance.id,
          tenantId: tenant.id,
          tenantName: tenant.name,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
          adminName: data.adminName,
        });
      }

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
    data: AppInstanceUpdatePayload,
    tenantId: string,
  ) {
    const current = await prisma.appInstance.findUnique({
      where: { id },
      select: {
        tier: true,
        addons: true,
        appUrl: true,
        adminEmail: true,
        adminPassword: true,
        adminName: true,
        modules: {
          where: {
            isEnabled: true,
          },
          include: {
            moduleDefinition: {
              select: {
                moduleKey: true,
              },
            },
          },
        },
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            businessCategory: true,
          },
        },
        solution: {
          select: {
            code: true,
            name: true,
          },
        },
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

    const resolvedModuleKeys =
      moduleKeys === undefined
        ? undefined
        : normalizeModuleKeys(moduleKeys);
    const resolvedAppUrl = resolveEffectiveAppUrl({
      appUrl: data.appUrl !== undefined ? data.appUrl : current.appUrl,
      tenant: current.tenant,
      solution: current.solution,
    });
    const nextAdminEmail = data.adminEmail !== undefined ? data.adminEmail : current.adminEmail;
    const nextAdminPassword = data.adminPassword !== undefined ? data.adminPassword : current.adminPassword;
    const nextAdminName = data.adminName !== undefined ? data.adminName : current.adminName;
    const solutionType = resolveSolutionModuleCatalogType(current.solution);

    const updated = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.appInstance.updateMany({
        where: { id: id, tenantId: tenantId },
        data: {
          ...restData,
          dbConnectionString: null,
          appUrl: resolvedAppUrl,
          ...(syncMode !== undefined ? { syncMode } : {}),
          ...(endDate !== undefined ? { endDate: AppInstanceService.parseEndDateInput(endDate) } : {}),
        },
      });

      if (updateResult.count === 0) {
        throw new AppError('App instance not found', 404);
      }

      await AppInstanceService.syncAppInstanceModules(tx, id, {
        solutionType,
        tier: data.tier ?? current.tier,
        addons: data.addons ?? current.addons,
        moduleKeys: resolvedModuleKeys,
        businessCategory: current.tenant.businessCategory,
      });

      if (solutionType === 'SCHOOL_ERP') {
        await ensureSchoolErpAdminAccess(tx, {
          appInstanceId: id,
          tenantId: current.tenant.id,
          tenantName: current.tenant.name,
          adminEmail: nextAdminEmail,
          adminPassword: nextAdminPassword,
          adminName: nextAdminName,
        });
      }

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

  static async syncBusinessCategoryModulesForTenant(
    tenantId: string,
    businessCategory: BusinessCategory,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const appInstances = await tx.appInstance.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          tier: true,
          addons: true,
          solution: {
            select: {
              code: true,
              name: true,
            },
          },
          modules: {
            where: {
              isEnabled: true,
            },
            include: {
              moduleDefinition: {
                select: {
                  moduleKey: true,
                },
              },
            },
          },
        },
      });

      for (const appInstance of appInstances) {
        const solutionType = resolveSolutionModuleCatalogType(appInstance.solution);
        if (solutionType !== 'POS') {
          continue;
        }

        await AppInstanceService.syncAppInstanceModules(tx, appInstance.id, {
          solutionType,
          tier: appInstance.tier,
          addons: appInstance.addons,
          moduleKeys: appInstance.modules.map((item) => item.moduleDefinition.moduleKey),
          businessCategory,
        });
      }
    });
  }
}
