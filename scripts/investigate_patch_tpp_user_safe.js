require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const tenantRes = await client.query(
      `SELECT id, name, slug FROM tenants WHERE name ILIKE $1 ORDER BY name ASC`,
      ['%tanto%pink%putra%']
    );

    console.log('=== Tenant Tanto Pink Putra ===');
    console.table(tenantRes.rows);

    const targetTenant = tenantRes.rows[0] || null;

    const candidatesRes = await client.query(
      `
      SELECT
        u.id,
        u.username,
        u.email,
        u.name,
        u.role::text AS role,
        u."tenantId",
        t.name AS "tenantName",
        u."createdAt"
      FROM users u
      LEFT JOIN tenants t ON t.id = u."tenantId"
      WHERE
        lower(COALESCE(u.username, '')) = 'tpp'
        OR lower(COALESCE(u.name, '')) LIKE '%tpp%'
        OR lower(COALESCE(u.email, '')) LIKE '%tpp%'
      ORDER BY u."createdAt" DESC
      `
    );

    console.log('\n=== Kandidat user legacy tpp ===');
    console.table(candidatesRes.rows);

    const patchable = candidatesRes.rows.filter((row) => row.role !== 'SUPER_ADMIN');

    if (patchable.length === 0) {
      console.log('\nTidak ada kandidat non-SUPER_ADMIN untuk dipatch.');
      return;
    }

    const target =
      patchable.find((row) => (row.username || '').toLowerCase() === 'tpp') ||
      patchable[0];

    console.log('\n=== User target patch ===');
    console.table([target]);

    const needsUsernamePatch = !target.username || target.username.trim() === '';
    const needsTenantPatch =
      targetTenant && (!target.tenantId || target.tenantId !== targetTenant.id);

    if (!needsUsernamePatch && !needsTenantPatch) {
      console.log('\nTidak perlu patch: username dan tenantId sudah sesuai.');
      return;
    }

    await client.query('BEGIN');

    if (needsUsernamePatch) {
      const conflictRes = await client.query(
        `
        SELECT id
        FROM users
        WHERE lower(username) = 'tpp'
          AND id <> $1
          AND "tenantId" = $2
        LIMIT 1
        `,
        [target.id, targetTenant ? targetTenant.id : target.tenantId]
      );

      if (conflictRes.rows.length > 0) {
        throw new Error('Username tpp sudah dipakai user lain di tenant target.');
      }

      await client.query(
        `UPDATE users SET username = 'tpp', "updatedAt" = NOW() WHERE id = $1`,
        [target.id]
      );
    }

    if (needsTenantPatch && targetTenant) {
      await client.query(
        `UPDATE users SET "tenantId" = $2, "updatedAt" = NOW() WHERE id = $1`,
        [target.id, targetTenant.id]
      );
    }

    await client.query('COMMIT');
    console.log('\nPatch sukses diterapkan.');

    const afterRes = await client.query(
      `
      SELECT
        u.id,
        u.username,
        u.email,
        u.name,
        u.role::text AS role,
        u."tenantId",
        t.name AS "tenantName",
        u."updatedAt"
      FROM users u
      LEFT JOIN tenants t ON t.id = u."tenantId"
      WHERE u.id = $1
      `,
      [target.id]
    );

    console.log('\n=== Data setelah patch ===');
    console.table(afterRes.rows);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Gagal proses patch aman:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
