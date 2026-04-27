require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" TEXT;');
    await client.query('ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;');
    await client.query('CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users"("username");');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_username_key" ON "users"("tenantId", "username");');

    await client.query('COMMIT');
    console.log('Schema update applied: users.username added, users.email nullable, tenant+username unique index created.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed applying POS user schema update:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
