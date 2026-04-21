import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import {
  POS_MODULE_CATALOG,
  resolveLegacyModuleAssignments,
} from '../constants/moduleCatalog';

function toNullableInputJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value == null) {
    return {};
  }
  return value as Prisma.InputJsonValue;
}

async function main() {
  for (const moduleDefinition of POS_MODULE_CATALOG) {
    await prisma.moduleDefinition.upsert({
      where: { moduleKey: moduleDefinition.moduleKey },
      update: {
        displayName: moduleDefinition.displayName,
        category: moduleDefinition.category,
        description: moduleDefinition.description,
        isCore: moduleDefinition.isCore ?? false,
        status: 'ACTIVE',
        dependencies: moduleDefinition.dependencies ?? [],
        defaultConfig: toNullableInputJson(moduleDefinition.defaultConfig),
      },
      create: {
        moduleKey: moduleDefinition.moduleKey,
        displayName: moduleDefinition.displayName,
        category: moduleDefinition.category,
        description: moduleDefinition.description,
        isCore: moduleDefinition.isCore ?? false,
        status: 'ACTIVE',
        dependencies: moduleDefinition.dependencies ?? [],
        defaultConfig: toNullableInputJson(moduleDefinition.defaultConfig),
      },
    });
  }

  const moduleDefinitions = await prisma.moduleDefinition.findMany({
    select: { id: true, moduleKey: true },
  });
  const moduleDefinitionByKey = new Map(
    moduleDefinitions.map((definition) => [definition.moduleKey, definition.id]),
  );

  const missingDefinitionKeys = POS_MODULE_CATALOG
    .map((entry) => entry.moduleKey)
    .filter((moduleKey) => !moduleDefinitionByKey.has(moduleKey));
  if (missingDefinitionKeys.length > 0) {
    throw new Error(
      `Module definition bootstrap incomplete. Missing keys: ${missingDefinitionKeys.join(', ')}`,
    );
  }

  const appInstances = await prisma.appInstance.findMany({
    where: {
      status: 'ACTIVE',
      solution: {
        is: {
          code: 'POS',
        },
      },
    },
    include: {
      modules: true,
    },
  });

  let createdOrUpdated = 0;
  let skippedManualOverrides = 0;
  let scannedAssignments = 0;

  for (const appInstance of appInstances) {
    const existingByModuleDefinitionId = new Map(
      appInstance.modules.map((module) => [module.moduleDefinitionId, module]),
    );
    const legacyAssignments = resolveLegacyModuleAssignments({
      tier: appInstance.tier,
      addons: appInstance.addons,
    });

    for (const [moduleKey, assignment] of Object.entries(legacyAssignments)) {
      scannedAssignments += 1;
      const moduleDefinitionId = moduleDefinitionByKey.get(moduleKey);
      if (!moduleDefinitionId) {
        console.warn(`WARN: Module definition missing for key ${moduleKey}`);
        continue;
      }

      const existing = existingByModuleDefinitionId.get(moduleDefinitionId);
      if (existing?.source === 'MANUAL_OVERRIDE' && existing.isEnabled) {
        skippedManualOverrides += 1;
        continue;
      }

      await prisma.appInstanceModule.upsert({
        where: {
          appInstanceId_moduleDefinitionId: {
            appInstanceId: appInstance.id,
            moduleDefinitionId,
          },
        },
        update: {
          isEnabled: true,
          source: assignment.source,
          billingStatus: existing?.billingStatus ?? 'ACTIVE',
          activatedAt: existing?.activatedAt ?? appInstance.createdAt,
          expiredAt: null,
          config: toNullableInputJson(assignment.config ?? existing?.config),
          limits: toNullableInputJson(assignment.limits ?? existing?.limits),
        },
        create: {
          appInstanceId: appInstance.id,
          moduleDefinitionId,
          isEnabled: true,
          source: assignment.source,
          billingStatus: 'ACTIVE',
          activatedAt: appInstance.createdAt,
          config: toNullableInputJson(assignment.config),
          limits: toNullableInputJson(assignment.limits),
        },
      });
      createdOrUpdated += 1;
    }
  }

  console.log(
    `SUCCESS: Backfilled ${createdOrUpdated} app-instance module assignments across ${appInstances.length} POS app instances`,
  );
  console.log(`INFO: Scanned ${scannedAssignments} legacy module assignments`);
  console.log(`INFO: Skipped ${skippedManualOverrides} manual override assignments`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('FAILED:', message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });