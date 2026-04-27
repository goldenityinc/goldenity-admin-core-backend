import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { POS_MODULE_CATALOG } from '../constants/moduleCatalog';

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

  console.log(`SUCCESS: Seeded ${POS_MODULE_CATALOG.length} module definitions`);
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