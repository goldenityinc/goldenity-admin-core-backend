const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const tenantDbUrl = process.argv[2];
  const username = process.argv[3];
  const plainPassword = process.argv[4];

  if (!tenantDbUrl || !username || !plainPassword) {
    console.error('Usage: node scripts/hash_tenant_password.js "<tenant_db_url>" "<username>" "<plain_password>"');
    process.exit(1);
  }

  const saltRounds = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
  const safeSaltRounds = Number.isNaN(saltRounds) ? 12 : Math.min(Math.max(saltRounds, 4), 14);

  const client = new Client({
    connectionString: tenantDbUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const existing = await client.query(
      'SELECT id, username, password FROM app_users WHERE username = $1 LIMIT 1',
      [username]
    );

    if (existing.rowCount === 0) {
      throw new Error(`User '${username}' tidak ditemukan di app_users`);
    }

    const row = existing.rows[0];
    const currentPassword = String(row.password || '');

    if (currentPassword.startsWith('$2a$') || currentPassword.startsWith('$2b$') || currentPassword.startsWith('$2y$')) {
      const alreadyValid = await bcrypt.compare(plainPassword, currentPassword);
      if (alreadyValid) {
        console.log(`Password user '${username}' sudah dalam bentuk hash bcrypt dan valid.`);
        return;
      }
    }

    const hashed = await bcrypt.hash(plainPassword, safeSaltRounds);
    await client.query('UPDATE app_users SET password = $1 WHERE id = $2', [hashed, row.id]);

    const verify = await client.query('SELECT password FROM app_users WHERE id = $1', [row.id]);
    const stored = String(verify.rows[0]?.password || '');
    const ok = await bcrypt.compare(plainPassword, stored);

    if (!ok) {
      throw new Error('Verifikasi hash gagal setelah update password');
    }

    console.log(`SUKSES: password user '${username}' berhasil di-hash (bcrypt).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`GAGAL: ${error.message}`);
  process.exit(1);
});
