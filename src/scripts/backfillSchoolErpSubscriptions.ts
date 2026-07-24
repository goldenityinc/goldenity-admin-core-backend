import prisma from '../config/database';
import { AppInstanceService } from '../services/appInstanceService';

type BackfillSchoolErpAppInstance = {
  id: string;
  tenantId: string;
  appUrl: string | null;
  adminEmail: string | null;
  adminPassword: string | null;
  adminName: string | null;
  tenant: {
    slug: string;
  };
};

function normalizeOrigin(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function resolveSchoolErpOrigin(): string {
  return normalizeOrigin(
    process.env.SCHOOL_ERP_WEB_ORIGIN ||
      process.env.SCHOOL_ERP_WEB_URL ||
      process.env.SCHOOL_ERP_APP_URL,
  );
}

async function main(): Promise<void> {
  const schoolErpOrigin = resolveSchoolErpOrigin();
  if (!schoolErpOrigin) {
    throw new Error(
      'SCHOOL_ERP_WEB_ORIGIN belum diisi. Isi origin production School ERP sebelum menjalankan backfill.',
    );
  }

  const appInstances = (await prisma.appInstance.findMany({
    where: {
      solution: {
        code: 'SCHOOL_ERP',
      },
    },
    include: {
      tenant: {
        select: {
          slug: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  })) as unknown as BackfillSchoolErpAppInstance[];

  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const appInstance of appInstances) {
    const targetAppUrl =
      appInstance.appUrl?.trim() ||
      `${schoolErpOrigin}/login?tenantSlug=${encodeURIComponent(appInstance.tenant.slug)}`;

    try {
      await AppInstanceService.update(
        appInstance.id,
        {
          appUrl: targetAppUrl,
          adminEmail: appInstance.adminEmail ?? undefined,
          adminPassword: appInstance.adminPassword ?? undefined,
          adminName: appInstance.adminName ?? undefined,
        },
        appInstance.tenantId,
      );

      updatedCount += 1;
      console.log(`OK ${appInstance.tenant.slug} -> ${targetAppUrl}`);
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAILED ${appInstance.tenant.slug}: ${message}`);

      if (!appInstance.adminEmail || !appInstance.adminPassword) {
        skippedCount += 1;
      }
    }
  }

  console.log('SUMMARY', {
    total: appInstances.length,
    updatedCount,
    skippedCount,
    failedCount,
  });
}

main()
  .catch((error) => {
    console.error('BACKFILL_FAILED', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
