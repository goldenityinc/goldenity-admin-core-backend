require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;');
    await client.query('ALTER TABLE "users" ALTER COLUMN "firebaseUid" DROP NOT NULL;');

    await client.query('COMMIT');
    console.log('Schema update applied: users.passwordHash added, users.firebaseUid nullable.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to apply schema update:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
