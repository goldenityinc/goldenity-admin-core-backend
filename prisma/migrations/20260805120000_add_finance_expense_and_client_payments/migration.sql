-- Add PaymentStatusEnum type
DO $$ BEGIN
    CREATE TYPE "PaymentStatusEnum" AS ENUM ('Paid', 'NotPaid');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns to expenses table
ALTER TABLE "expenses"
    ADD COLUMN IF NOT EXISTS "pic_name" TEXT;

ALTER TABLE "expenses"
    ADD COLUMN IF NOT EXISTS "payment_status" "PaymentStatusEnum" DEFAULT 'NotPaid';

CREATE INDEX IF NOT EXISTS "expenses_tenant_id_payment_status_idx"
    ON "expenses" ("tenant_id", "payment_status");

-- Create expense_attachments table for many-to-one multiple uploads
CREATE TABLE IF NOT EXISTS "expense_attachments" (
    "id" BIGSERIAL PRIMARY KEY,
    "expense_id" BIGINT NOT NULL,
    "tenant_id" TEXT,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_attachments_expense_id_fkey"
        FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "expense_attachments_expense_id_idx"
    ON "expense_attachments" ("expense_id");

CREATE INDEX IF NOT EXISTS "expense_attachments_tenant_id_idx"
    ON "expense_attachments" ("tenant_id");

-- Recreate client_payment_records matrix table (product_id = String UUID/sku matches products.id VARCHAR)
DROP TABLE IF EXISTS "client_payment_records" CASCADE;

CREATE TABLE "client_payment_records" (
    "id" BIGSERIAL PRIMARY KEY,
    "tenant_id" TEXT,
    "client_id" BIGINT NOT NULL,
    "product_id" VARCHAR(255) NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "status" "PaymentStatusEnum" NOT NULL DEFAULT 'NotPaid',
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "receipt_images" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_payments_per_cell"
    ON "client_payment_records" ("tenant_id", "client_id", "product_id", "period_month", "period_year");

CREATE INDEX IF NOT EXISTS "client_payment_records_tenant_id_idx"
    ON "client_payment_records" ("tenant_id");

CREATE INDEX IF NOT EXISTS "client_payment_records_tenant_period_idx"
    ON "client_payment_records" ("tenant_id", "period_year", "period_month");

CREATE INDEX IF NOT EXISTS "client_payment_records_tenant_client_idx"
    ON "client_payment_records" ("tenant_id", "client_id");
