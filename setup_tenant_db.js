const { Pool } = require('pg');
const fs = require('fs/promises');
const path = require('path');

async function main() {
  const targetDbUrl = process.argv[2];
  const storeName = process.argv[3] || 'Point of Sales';
  const subscriptionTier = process.argv[4] || 'Standard';

  if (!targetDbUrl) {
    console.error(
      'Usage: node setup_tenant_db.js "postgresql://user:pass@host:port/dbname" "Store Name" "Tier"',
    );
    process.exit(1);
  }

  const schemaPath = path.resolve(__dirname, 'master_schema.sql');
  let pool;

  try {
    console.log('Membaca file master_schema.sql...');
    const schemaSql = await fs.readFile(schemaPath, 'utf8');

    if (!schemaSql.trim()) {
      throw new Error('File master_schema.sql kosong.');
    }

    console.log('Membuka koneksi ke database tenant target...');
    pool = new Pool({
      connectionString: targetDbUrl,
      ssl: { rejectUnauthorized: false },
    });

    console.log('Menjalankan schema provisioning...');
    await pool.query(schemaSql);

    // Ensure tenant has a deterministic settings row for Flutter to read with id=1.
    await pool.query(
      `
      INSERT INTO store_settings (
        id,
        store_name,
        address,
        npwp,
        logo_url,
        apply_tax,
        is_tax_exclusive,
        subscription_tier,
        paper_size
      )
      VALUES ($1, $2, '-', '-', NULL, false, true, $3, 'roll57')
      ON CONFLICT (id) DO UPDATE
      SET
        store_name = EXCLUDED.store_name,
        subscription_tier = EXCLUDED.subscription_tier
      `,
      [1, storeName, subscriptionTier],
    );

    console.log(
      `SUKSES: store_settings seed id=1 -> store_name="${storeName}", subscription_tier="${subscriptionTier}"`,
    );

    console.log('SUKSES: Database tenant berhasil diprovision menggunakan master_schema.sql');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GAGAL provisioning database tenant: ${message}`);
    process.exitCode = 1;
  } finally {
    if (pool) {
      await pool.end();
      console.log('Koneksi database ditutup.');
    }
  }
}

main();
