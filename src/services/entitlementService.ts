import prisma from '../config/database';
import { resolveLegacyModuleAssignments } from '../constants/moduleCatalog';
import { normalizeSubscriptionAddons } from '../constants/subscriptionAddons';
import type {
  ModuleEntitlementDto,
  TenantEntitlementsDto,
} from '../types/auth';

type ResolvedSubscription = {
  tier: string | null;
  addons: string[];
  endDate: string | null;
};

type ResolvedTenantEntitlements = {
  entitlements: TenantEntitlementsDto;
  subscription: ResolvedSubscription;
  appInstanceId: string | null;
};

type NormalizedModuleDefaults = {
  config: Record<string, unknown>;
  limits: Record<string, unknown>;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function computeRevision(candidates: Date[]): number {
  const latest = candidates.reduce<Date | null>((current, candidate) => {
    if (current == null || candidate.getTime() > current.getTime()) {
      return candidate;
    }
    return current;
  }, null);

  if (latest == null) {
    return 0;
  }

  return Math.trunc(latest.getTime() / 1000);
}

function toIsoStringOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function normalizeModuleDefaults(value: unknown): NormalizedModuleDefaults {
  const raw = toRecord(value);
  const config: Record<string, unknown> = {};
  const limits: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(raw)) {
    if (key.startsWith('max_') || key.endsWith('_limit')) {
      limits[key] = entryValue;
      continue;
    }
    config[key] = entryValue;
  }

  return { config, limits };
}

function mergeModulePayload(
  moduleDefinitionDefaultConfig: unknown,
  assignmentConfig: unknown,
  assignmentLimits: unknown,
): Pick<ModuleEntitlementDto, 'config' | 'limits'> {
  const defaults = normalizeModuleDefaults(moduleDefinitionDefaultConfig);
  return {
    config: {
      ...defaults.config,
      ...toRecord(assignmentConfig),
    },
    limits: {
      ...defaults.limits,
      ...toRecord(assignmentLimits),
    },
  };
}

export class EntitlementService {
  static async resolveForTenant(
    tenantId: string,
  ): Promise<ResolvedTenantEntitlements> {
    const appInstance =
      (await prisma.appInstance.findFirst({
        where: {
          tenantId,
          status: 'ACTIVE',
          solution: { is: { code: 'POS' } },
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          modules: {
            include: { moduleDefinition: true },
            orderBy: { updatedAt: 'desc' },
          },
        },
      })) ??
      (await prisma.appInstance.findFirst({
        where: {
          tenantId,
          status: 'ACTIVE',
          solution: {
            is: {
              name: {
                contains: 'POS',
                mode: 'insensitive',
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          modules: {
            include: { moduleDefinition: true },
            orderBy: { updatedAt: 'desc' },
          },
        },
      })) ??
      (await prisma.appInstance.findFirst({
        where: { tenantId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        include: {
          modules: {
            include: { moduleDefinition: true },
            orderBy: { updatedAt: 'desc' },
          },
        },
      }));

    if (!appInstance) {
      return {
        entitlements: {
          revision: 0,
          resolvedAt: new Date().toISOString(),
          active_modules: [],
          modules: {},
        },
        subscription: {
          tier: null,
          addons: [],
          endDate: null,
        },
        appInstanceId: null,
      };
    }

    const subscription: ResolvedSubscription = {
      tier: appInstance.tier ?? null,
      addons: normalizeSubscriptionAddons(appInstance.addons),
      endDate: toIsoStringOrNull(appInstance.endDate),
    };

    const now = new Date();
    const enabledAssignments = appInstance.modules.filter(
      (assignment) =>
        assignment.isEnabled &&
        assignment.moduleDefinition.status !== 'ARCHIVED' &&
        (!assignment.expiredAt || assignment.expiredAt > now),
    );

    const modules: Record<string, ModuleEntitlementDto> = {};

    if (enabledAssignments.length > 0) {
      for (const assignment of enabledAssignments) {
        const moduleKey = assignment.moduleDefinition.moduleKey.trim();
        if (!moduleKey) {
          continue;
        }

        const mergedPayload = mergeModulePayload(
          assignment.moduleDefinition.defaultConfig,
          assignment.config,
          assignment.limits,
        );

        modules[moduleKey] = {
          enabled: true,
          source: assignment.source,
          config: mergedPayload.config,
          limits: mergedPayload.limits,
          activatedAt: toIsoStringOrNull(assignment.activatedAt),
          expiredAt: toIsoStringOrNull(assignment.expiredAt),
        };
      }
    } else {
      const legacyAssignments = resolveLegacyModuleAssignments({
        tier: subscription.tier,
        addons: subscription.addons,
      });

      for (const [moduleKey, assignment] of Object.entries(legacyAssignments)) {
        modules[moduleKey] = {
          enabled: true,
          source: assignment.source,
          config: assignment.config ?? {},
          limits: assignment.limits ?? {},
          activatedAt: null,
          expiredAt: null,
        };
      }
    }

    const activeModules = Object.entries(modules)
      .filter(([, module]) => module.enabled)
      .map(([moduleKey]) => moduleKey)
      .sort();

    const revisionCandidates = [appInstance.updatedAt, ...enabledAssignments.map((item) => item.updatedAt)];
    const entitlements: TenantEntitlementsDto = {
      revision: computeRevision(revisionCandidates),
      resolvedAt: new Date().toISOString(),
      active_modules: activeModules,
      modules,
    };

    return {
      entitlements,
      subscription,
      appInstanceId: appInstance.id,
    };
  }
}