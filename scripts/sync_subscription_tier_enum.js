require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const sql = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'SubscriptionTier' AND e.enumlabel = 'BASIC'
  ) THEN
    ALTER TYPE "SubscriptionTier" RENAME VALUE 'BASIC' TO 'Standard';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'SubscriptionTier' AND e.enumlabel = 'PRO'
  ) THEN
    ALTER TYPE "SubscriptionTier" RENAME VALUE 'PRO' TO 'Professional';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'SubscriptionTier' AND e.enumlabel = 'ENTERPRISE'
  ) THEN
    ALTER TYPE "SubscriptionTier" RENAME VALUE 'ENTERPRISE' TO 'Enterprise';
  END IF;
END
$$;
`;

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('SubscriptionTier enum synchronized to Title Case values.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed syncing SubscriptionTier enum:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
