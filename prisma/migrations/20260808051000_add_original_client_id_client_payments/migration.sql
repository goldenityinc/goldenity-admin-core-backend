ALTER TABLE IF EXISTS "client_payment_records"
  ADD COLUMN IF NOT EXISTS "original_client_id" VARCHAR(128);

CREATE INDEX IF NOT EXISTS "idx_client_payment_records_tenant_original_client"
  ON "client_payment_records" ("tenant_id", "original_client_id");
