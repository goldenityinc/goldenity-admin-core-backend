require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.log('=== INVESTIGASI TENANT TARGET ===');
    const tenantRes = await client.query(
      `
      SELECT id, name, slug, "isActive"
      FROM tenants
      WHERE name ILIKE $1
      ORDER BY name ASC
      `,
      ['%tanto%pink%putra%']
    );

    console.table(tenantRes.rows);

    const targetTenant = tenantRes.rows[0] || null;

    console.log('\n=== INVESTIGASI USER KANDIDAT (tpp/admin/email) ===');
    const userRes = await client.query(
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
        u.username ILIKE $1
        OR u.name ILIKE $1
        OR COALESCE(u.email, '') ILIKE $1
        OR u.role::text ILIKE $2
      ORDER BY u."createdAt" DESC
      `,
      ['%tpp%', '%admin%']
    );

    console.table(userRes.rows);

    const candidate =
      userRes.rows.find((row) => (row.username || '').toLowerCase() === 'tpp') ||
      userRes.rows.find((row) => (row.name || '').toLowerCase().includes('tpp')) ||
      userRes.rows.find((row) => (row.email || '').toLowerCase().includes('tpp')) ||
      userRes.rows[0] ||
      null;

    if (!candidate) {
      console.log('\nTidak ada kandidat user yang cocok untuk dipatch.');
      return;
    }

    console.log('\n=== TARGET USER DIPILIH UNTUK PATCH ===');
    console.table([candidate]);

    const needsUsernamePatch = !candidate.username || candidate.username.trim() === '';
    const needsTenantPatch =
      targetTenant && (!candidate.tenantId || candidate.tenantId !== targetTenant.id);

    if (!needsUsernamePatch && !needsTenantPatch) {
      console.log('\nTidak perlu patch: username dan tenantId sudah sesuai.');
    } else {
      await client.query('BEGIN');

      if (needsUsernamePatch) {
        const conflictRes = await client.query(
          `
          SELECT id
          FROM users
          WHERE lower(username) = 'tpp'
            AND id <> $1
            AND ("tenantId" = $2 OR $2 IS NULL)
          LIMIT 1
          `,
          [candidate.id, targetTenant ? targetTenant.id : candidate.tenantId]
        );

        if (conflictRes.rows.length > 0) {
          throw new Error('Tidak bisa set username=tpp karena sudah dipakai user lain di tenant target.');
        }

        await client.query(
          `
          UPDATE users
          SET username = 'tpp', "updatedAt" = NOW()
          WHERE id = $1
          `,
          [candidate.id]
        );
      }

      if (needsTenantPatch && targetTenant) {
        await client.query(
          `
          UPDATE users
          SET "tenantId" = $2, "updatedAt" = NOW()
          WHERE id = $1
          `,
          [candidate.id, targetTenant.id]
        );
      }

      await client.query('COMMIT');
      console.log('\nPatch sukses diterapkan.');
    }

    console.log('\n=== DATA USER SETELAH PATCH ===');
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
        u."createdAt",
        u."updatedAt"
      FROM users u
      LEFT JOIN tenants t ON t.id = u."tenantId"
      WHERE u.id = $1
      `,
      [candidate.id]
    );

    console.table(afterRes.rows);

    console.log('\n=== CEK ORPHAN RELATION ===');
    const orphanRes = await client.query(`
      SELECT COUNT(*)::int AS total_orphan_users
      FROM users u
      LEFT JOIN tenants t ON t.id = u."tenantId"
      WHERE t.id IS NULL
    `);

    console.table(orphanRes.rows);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }

    console.error('Gagal investigasi/patch:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
