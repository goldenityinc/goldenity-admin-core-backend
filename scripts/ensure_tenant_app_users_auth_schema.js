require('dotenv').config();
const { Client } = require('pg');

const DEFAULT_SSL = { rejectUnauthorized: false };

async function applyAppUsersAuthSchema(connectionString, tenantId) {
  const client = new Client({ connectionString, ssl: DEFAULT_SSL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT,
        password TEXT,
        role TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username TEXT');
    await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password TEXT');
    await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role TEXT');
    await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE');
    await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()');
    await client.query('CREATE INDEX IF NOT EXISTS app_users_username_idx ON app_users(username)');

    return { tenantId, ok: true };
  } catch (error) {
    return { tenantId, ok: false, error: error.message || String(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function loadTenantDbTargets(masterClient, tenantId) {
  const tenantColumnRes = await masterClient.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenants'
      AND column_name IN ('db_connection_url', 'dbConnectionUrl')
    `,
  );

  const tenantDbColumn = tenantColumnRes.rows.find((row) => row.column_name === 'db_connection_url')
    ? 'db_connection_url'
    : tenantColumnRes.rows.find((row) => row.column_name === 'dbConnectionUrl')
    ? 'dbConnectionUrl'
    : null;

  if (tenantDbColumn) {
    const tenantUrlQuery = tenantId
      ? `
        SELECT t.id AS "tenantId", t."${tenantDbColumn}" AS "dbConnectionString"
        FROM tenants t
        WHERE t.id = $1
          AND t."${tenantDbColumn}" IS NOT NULL
      `
      : `
        SELECT t.id AS "tenantId", t."${tenantDbColumn}" AS "dbConnectionString"
        FROM tenants t
        WHERE t."${tenantDbColumn}" IS NOT NULL
      `;

    const tenantUrlRes = tenantId
      ? await masterClient.query(tenantUrlQuery, [tenantId])
      : await masterClient.query(tenantUrlQuery);

    if (tenantUrlRes.rows.length > 0) {
      return tenantUrlRes.rows;
    }
  }

  if (tenantId) {
    const result = await masterClient.query(
      `
      SELECT DISTINCT ai."tenantId" AS "tenantId", ai."dbConnectionString" AS "dbConnectionString"
      FROM app_instances ai
      WHERE ai."tenantId" = $1
        AND ai."dbConnectionString" IS NOT NULL
      ORDER BY ai."tenantId"
      `,
      [tenantId],
    );

    return result.rows;
  }

  const result = await masterClient.query(`
    SELECT DISTINCT ON (ai."tenantId")
      ai."tenantId" AS "tenantId",
      ai."dbConnectionString" AS "dbConnectionString"
    FROM app_instances ai
    WHERE ai."dbConnectionString" IS NOT NULL
    ORDER BY
      ai."tenantId",
      CASE ai.status
        WHEN 'ACTIVE' THEN 0
        WHEN 'DEPLOYING' THEN 1
        WHEN 'SUSPENDED' THEN 2
        ELSE 3
      END,
      ai."updatedAt" DESC,
      ai."createdAt" DESC
  `);

  return result.rows;
}

async function loadSingleDbFallbackTarget(masterClient) {
  const row = await masterClient.query(
    `SELECT id AS "tenantId" FROM tenants ORDER BY "createdAt" ASC LIMIT 1`,
  );

  const fallbackTenantId = row.rows[0]?.tenantId || 'single-db';
  return [{ tenantId: fallbackTenantId, dbConnectionString: process.env.DATABASE_URL }];
}

async function run() {
  const masterDbUrl = process.env.DATABASE_URL;
  const tenantId = process.argv[2] || null;

  if (!masterDbUrl) {
    throw new Error('DATABASE_URL belum diset.');
  }

  const masterClient = new Client({ connectionString: masterDbUrl, ssl: DEFAULT_SSL });
  await masterClient.connect();

  try {
    const targets = await loadTenantDbTargets(masterClient, tenantId);

    const resolvedTargets = targets.length > 0 ? targets : await loadSingleDbFallbackTarget(masterClient);

    if (!resolvedTargets.length) {
      throw new Error(
        tenantId
          ? `Tidak ada dbConnectionString ditemukan untuk tenantId=${tenantId}`
          : 'Tidak ada tenant dbConnectionString yang bisa diproses.'
      );
    }

    if (!targets.length) {
      console.warn(
        'dbConnectionString tenant tidak ditemukan. Fallback ke DATABASE_URL (single DB mode).',
      );
    }

    const results = [];

    for (const target of resolvedTargets) {
      const result = await applyAppUsersAuthSchema(target.dbConnectionString, target.tenantId);
      results.push(result);
      if (result.ok) {
        console.log(`[OK] tenantId=${result.tenantId} schema app_users auth sinkron.`);
      } else {
        console.error(`[FAIL] tenantId=${result.tenantId} ${result.error}`);
      }
    }

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`Selesai dengan kegagalan: ${failed.length}/${results.length} tenant.`);
    } else {
      console.log(`Selesai sukses: ${results.length} tenant.`);
    }
  } finally {
    await masterClient.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(`GAGAL: ${error.message || error}`);
  process.exit(1);
});
