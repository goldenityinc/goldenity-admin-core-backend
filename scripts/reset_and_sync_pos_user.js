require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const SSL = { rejectUnauthorized: false };

async function resolveTenantDbConnectionString(masterClient, tenantId) {
  const tenantColumns = await masterClient.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenants'
      AND column_name IN ('db_connection_url', 'dbConnectionUrl')
    `,
  );

  const tenantDbColumn = tenantColumns.rows.find((row) => row.column_name === 'db_connection_url')
    ? 'db_connection_url'
    : tenantColumns.rows.find((row) => row.column_name === 'dbConnectionUrl')
    ? 'dbConnectionUrl'
    : null;

  if (tenantDbColumn) {
    const tenantUrlResult = await masterClient.query(
      `SELECT "${tenantDbColumn}" AS "targetDbUrl" FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );

    const tenantUrl = tenantUrlResult.rows[0]?.targetDbUrl || null;
    if (tenantUrl) {
      return tenantUrl;
    }
  }

  const result = await masterClient.query(
    `
    SELECT ai."dbConnectionString"
    FROM app_instances ai
    WHERE ai."tenantId" = $1
      AND ai."dbConnectionString" IS NOT NULL
    ORDER BY
      CASE ai.status
        WHEN 'ACTIVE' THEN 0
        WHEN 'DEPLOYING' THEN 1
        WHEN 'SUSPENDED' THEN 2
        ELSE 3
      END,
      ai."updatedAt" DESC,
      ai."createdAt" DESC
    LIMIT 1
    `,
    [tenantId],
  );

  return result.rows[0]?.dbConnectionString || null;
}

async function ensureAppUsersAuthSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT,
      password TEXT,
      role TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      employee_type TEXT DEFAULT 'Kasir',
      base_salary DECIMAL(14, 2) DEFAULT 0,
      commission_rate DECIMAL(14, 2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username TEXT');
  await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password TEXT');
  await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role TEXT');
  await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE');
  await client.query("ALTER TABLE app_users ADD COLUMN IF NOT EXISTS employee_type TEXT DEFAULT 'Kasir'");
  await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS base_salary DECIMAL(14, 2) DEFAULT 0');
  await client.query('ALTER TABLE app_users ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(14, 2) DEFAULT 0');
  await client.query('CREATE INDEX IF NOT EXISTS app_users_username_idx ON app_users(username)');
}

async function upsertTenantAppUser(
  client,
  username,
  passwordHash,
  role,
  isActive,
  employeeType,
  baseSalary,
  commissionRate,
) {
  await ensureAppUsersAuthSchema(client);

  const existing = await client.query('SELECT id FROM app_users WHERE username = $1 LIMIT 1', [username]);

  if (existing.rowCount > 0) {
    await client.query(
      'UPDATE app_users SET password = $1, role = $2, is_active = $3, employee_type = $4, base_salary = $5, commission_rate = $6 WHERE username = $7',
      [passwordHash, role, !!isActive, employeeType || 'Kasir', Number(baseSalary || 0), Number(commissionRate || 0), username],
    );
    return;
  }

  await client.query(
    'INSERT INTO app_users (username, password, role, is_active, employee_type, base_salary, commission_rate) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [username, passwordHash, role, !!isActive, employeeType || 'Kasir', Number(baseSalary || 0), Number(commissionRate || 0)],
  );
}

async function run() {
  const username = process.argv[2];
  const plainPassword = process.argv[3];

  if (!username || !plainPassword) {
    throw new Error('Usage: npm run user:reset-and-sync-pos -- <username> <new_password>');
  }

  const masterDbUrl = process.env.DATABASE_URL;
  if (!masterDbUrl) {
    throw new Error('DATABASE_URL belum diset.');
  }

  const masterClient = new Client({ connectionString: masterDbUrl, ssl: SSL });
  await masterClient.connect();

  try {
    const userResult = await masterClient.query(
      `
      SELECT id, username, "tenantId", role::text AS role, "isActive"
      , "employee_type" AS "employeeType"
      , "base_salary" AS "baseSalary"
      , "commission_rate" AS "commissionRate"
      FROM users
      WHERE lower(username) = lower($1)
        AND role::text <> 'SUPER_ADMIN'
      ORDER BY "updatedAt" DESC
      LIMIT 1
      `,
      [username],
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new Error(`User '${username}' tidak ditemukan di master users.`);
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    await masterClient.query(
      'UPDATE users SET "passwordHash" = $1, "updatedAt" = NOW() WHERE id = $2',
      [passwordHash, user.id],
    );

    const tenantDbConnectionString = await resolveTenantDbConnectionString(masterClient, user.tenantId);
    const targetDbUrl = tenantDbConnectionString || masterDbUrl;

    const tenantClient = new Client({ connectionString: targetDbUrl, ssl: SSL });
    await tenantClient.connect();

    try {
      await upsertTenantAppUser(
        tenantClient,
        user.username,
        passwordHash,
        user.role || 'ADMIN',
        user.isActive,
        user.employeeType,
        user.baseSalary,
        user.commissionRate,
      );
    } finally {
      await tenantClient.end().catch(() => undefined);
    }

    console.log(
      `SUKSES: password '${user.username}' direset dan tersinkron ke app_users (tenantId=${user.tenantId}).`,
    );
    if (!tenantDbConnectionString) {
      console.log('INFO: dbConnectionString tenant tidak ada, fallback sinkronisasi menggunakan DATABASE_URL (single DB mode).');
    }
  } finally {
    await masterClient.end().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(`GAGAL: ${error.message || error}`);
  process.exit(1);
});
