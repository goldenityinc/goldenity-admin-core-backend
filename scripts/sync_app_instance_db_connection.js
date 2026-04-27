require('dotenv').config();
const { Client } = require('pg');

const SSL = { rejectUnauthorized: false };

async function detectTenantDbColumn(client) {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenants'
      AND column_name IN ('db_connection_url', 'dbConnectionUrl')
    `,
  );

  const hasSnake = result.rows.some((row) => row.column_name === 'db_connection_url');
  if (hasSnake) {
    return 'db_connection_url';
  }

  const hasCamel = result.rows.some((row) => row.column_name === 'dbConnectionUrl');
  if (hasCamel) {
    return 'dbConnectionUrl';
  }

  return null;
}

async function run() {
  const masterDbUrl = process.env.DATABASE_URL;
  if (!masterDbUrl) {
    throw new Error('DATABASE_URL belum diset.');
  }

  const client = new Client({ connectionString: masterDbUrl, ssl: SSL });
  await client.connect();

  try {
    const tenantDbColumn = await detectTenantDbColumn(client);

    if (!tenantDbColumn) {
      console.log('Kolom tenants.db_connection_url/dbConnectionUrl tidak ditemukan. Tidak ada perubahan.');
      return;
    }

    const preview = await client.query(
      `
      SELECT
        ai.id AS "appInstanceId",
        ai."tenantId" AS "tenantId",
        t.name AS "tenantName",
        ai.status,
        ai."dbConnectionString" AS "currentDbConnectionString",
        t."${tenantDbColumn}" AS "tenantDbConnectionUrl"
      FROM app_instances ai
      JOIN tenants t ON t.id = ai."tenantId"
      WHERE ai."dbConnectionString" IS NULL
        AND t."${tenantDbColumn}" IS NOT NULL
      ORDER BY ai."updatedAt" DESC
      `,
    );

    if (preview.rowCount === 0) {
      console.log('Tidak ada app_instances yang perlu diisi dbConnectionString.');
      return;
    }

    console.log(`Akan update ${preview.rowCount} app_instances.`);
    console.table(preview.rows);

    await client.query('BEGIN');

    const updateResult = await client.query(
      `
      UPDATE app_instances ai
      SET
        "dbConnectionString" = t."${tenantDbColumn}",
        "updatedAt" = NOW()
      FROM tenants t
      WHERE t.id = ai."tenantId"
        AND ai."dbConnectionString" IS NULL
        AND t."${tenantDbColumn}" IS NOT NULL
      `,
    );

    await client.query('COMMIT');

    console.log(`SUKSES: ${updateResult.rowCount} app_instances diupdate.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(`GAGAL: ${error.message || error}`);
  process.exit(1);
});
