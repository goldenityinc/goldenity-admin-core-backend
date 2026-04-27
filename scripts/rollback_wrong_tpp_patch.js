require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      UPDATE users
      SET username = NULL,
          "tenantId" = $2,
          "updatedAt" = NOW()
      WHERE id = $1
      `,
      ['ef711dcb-31e5-4b1b-be77-eaed449b0cb2', '755d8d58-b66f-4db7-bf91-6d0e36d38e6d']
    );

    await client.query('COMMIT');
    console.log('Rollback patch sukses untuk user ef711dcb-31e5-4b1b-be77-eaed449b0cb2.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Rollback gagal:', error.message || error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
