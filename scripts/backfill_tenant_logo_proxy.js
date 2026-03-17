/*
Backfill tenants that still store a private Tigris URL in `logo_url`.
- Infers `logo_object_key` from the path-style URL: /<bucket>/<key>
- Rewrites `logo_url` to the public proxy endpoint: /public/tenants/:id/logo?v=<updatedAt>

Run (locally with Railway vars):
  railway run -s goldenity-admin-core-backend -e production -- node scripts/backfill_tenant_logo_proxy.js
*/

const { PrismaClient } = require('@prisma/client');

function getPublicBaseUrl() {
  const explicit = (process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const railwayHost = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayHost) return `https://${railwayHost}`;

  return '';
}

function tryParseKeyFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/^\//, '').split('/');
    parts.shift(); // drop bucket
    const key = parts.join('/');
    return key || null;
  } catch {
    return null;
  }
}

async function main() {
  const prisma = new PrismaClient();
  const base = getPublicBaseUrl();
  if (!base) {
    throw new Error('PUBLIC_BASE_URL or RAILWAY_PUBLIC_DOMAIN must be set');
  }

  const tenants = await prisma.tenant.findMany({
    where: {
      logoObjectKey: null,
      logoUrl: { not: null },
    },
    select: { id: true, logoUrl: true, updatedAt: true },
  });

  let updatedCount = 0;
  for (const t of tenants) {
    const logoUrl = (t.logoUrl || '').trim();
    if (!logoUrl.startsWith('http')) continue;

    const key = tryParseKeyFromUrl(logoUrl);
    if (!key || !key.startsWith('tenants/')) continue;

    const v = String(t.updatedAt.getTime());
    const proxyUrl = `${base}/public/tenants/${t.id}/logo?v=${encodeURIComponent(v)}`;

    await prisma.tenant.update({
      where: { id: t.id },
      data: {
        logoObjectKey: key,
        logoUrl: proxyUrl,
      },
    });
    updatedCount += 1;
  }

  console.log(JSON.stringify({ ok: true, scanned: tenants.length, updated: updatedCount }));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
