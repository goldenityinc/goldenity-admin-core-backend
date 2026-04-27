import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

type TenantDbRow = {
  id: string;
  slug: string;
  targetDbUrl: string | null;
};

type TenantDbResolved = {
  id: string;
  slug: string;
  targetDbUrl: string;
};

async function resolveDbConnectionColumn(masterClient: Client): Promise<string> {
  const result = await masterClient.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenants'
        AND column_name IN ('db_connection_url', 'dbConnectionUrl')
    `
  );

  const columnNames = new Set(result.rows.map((row) => row.column_name));

  if (columnNames.has('db_connection_url')) {
    return 'db_connection_url';
  }

  if (columnNames.has('dbConnectionUrl')) {
    return 'dbConnectionUrl';
  }

  throw new Error(
    'Kolom db_connection_url tidak ditemukan di tabel tenants pada Master DB.'
  );
}

async function loadMasterSchema(): Promise<string> {
  const schemaFilePath = path.resolve(process.cwd(), 'master_schema.sql');
  const schemaSql = await fs.readFile(schemaFilePath, 'utf8');

  if (!schemaSql.trim()) {
    throw new Error('File master_schema.sql kosong.');
  }

  return schemaSql;
}

async function getTenantTargetDbUrl(
  masterClient: Client,
  tenantSlug: string
): Promise<TenantDbResolved> {
  const dbConnectionColumn = await resolveDbConnectionColumn(masterClient);
  const query = `
    SELECT id, slug, "${dbConnectionColumn}" AS "targetDbUrl"
    FROM tenants
    WHERE slug = $1
    LIMIT 1
  `;

  const result = await masterClient.query<TenantDbRow>(query, [tenantSlug]);
  const tenant = result.rows[0];

  if (!tenant) {
    throw new Error(`Tenant dengan slug '${tenantSlug}' tidak ditemukan.`);
  }

  if (!tenant.targetDbUrl) {
    throw new Error(
      `Tenant '${tenantSlug}' belum memiliki nilai db_connection_url.`
    );
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    targetDbUrl: tenant.targetDbUrl,
  };
}

async function applySchemaToTenantDb(targetDbUrl: string, schemaSql: string): Promise<void> {
  const targetClient = new Client({ connectionString: targetDbUrl });

  await targetClient.connect();

  try {
    await targetClient.query('BEGIN');
    await targetClient.query(schemaSql);
    await targetClient.query('COMMIT');
  } catch (error) {
    await targetClient.query('ROLLBACK');
    throw error;
  } finally {
    await targetClient.end();
  }
}

async function main() {
  const tenantSlug = process.argv[2]?.trim();
  if (!tenantSlug) {
    throw new Error('Usage: npm run provision:tenant -- <tenant_slug>');
  }

  const masterDbUrl = process.env.DATABASE_URL?.trim();
  if (!masterDbUrl) {
    throw new Error('DATABASE_URL belum di-set untuk Master DB.');
  }

  const schemaSql = await loadMasterSchema();
  const masterClient = new Client({ connectionString: masterDbUrl });

  await masterClient.connect();

  try {
    const tenant = await getTenantTargetDbUrl(masterClient, tenantSlug);

    console.log(`Provisioning tenant '${tenant.slug}' (id: ${tenant.id})...`);
    await applySchemaToTenantDb(tenant.targetDbUrl, schemaSql);
    console.log(`SUKSES: schema POS berhasil diterapkan ke DB tenant '${tenant.slug}'.`);
  } finally {
    await masterClient.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`GAGAL: ${message}`);
  process.exit(1);
});
