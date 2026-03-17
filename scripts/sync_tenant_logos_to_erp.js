/*
Sync tenant logoUrl to ERP organization profile.
Uses ERP master credentials from env (ERP_MASTER_EMAIL/PASSWORD or ERP_MASTER_ACCESS_TOKEN).

Run:
  railway run -s goldenity-admin-core-backend -e production -- node scripts/sync_tenant_logos_to_erp.js
*/

const { PrismaClient } = require('@prisma/client');
const { ErpProvisionService } = require('../dist/services/erpProvisionService');

async function main() {
  const prisma = new PrismaClient();

  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true, address: true, phone: true, logoUrl: true },
  });

  let synced = 0;
  for (const t of tenants) {
    const logoUrl = (t.logoUrl || '').trim();
    if (!logoUrl) continue;

    await ErpProvisionService.upsertOrganizationProfile({
      organizationId: t.slug,
      displayName: t.name,
      address: t.address || undefined,
      phone: t.phone || undefined,
      logoUrl,
    });
    synced += 1;
  }

  console.log(JSON.stringify({ ok: true, scanned: tenants.length, synced }));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
