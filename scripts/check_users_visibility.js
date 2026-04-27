require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const summary = await client.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE username IS NULL)::int AS username_null,
        COUNT(*) FILTER (WHERE "tenantId" IS NULL)::int AS tenant_null,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM tenants t WHERE t.id = users."tenantId"
          )
        )::int AS tenant_orphan
      FROM users
    `);

    const tppTenantUsers = await client.query(
      `
      SELECT u.id, u.username, u.email, u.name, u.role::text AS role, u."createdAt"
      FROM users u
      JOIN tenants t ON t.id = u."tenantId"
      WHERE t.name ILIKE $1
      ORDER BY u."createdAt" DESC
      `,
      ['%tanto%pink%putra%']
    );

    console.log('=== USER VISIBILITY SUMMARY ===');
    console.table(summary.rows);

    console.log('\n=== USERS UNDER TENANT TANTO PINK PUTRA ===');
    console.table(tppTenantUsers.rows);
  } catch (error) {
    console.error('Visibility check failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
