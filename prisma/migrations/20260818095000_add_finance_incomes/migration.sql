-- Migration: add_finance_incomes
-- Date: 2026-08-18
-- Purpose: Create incomes + income_attachments tables (mirror of expenses)
-- Enum PaymentStatusEnum already created by migration 20260805120000.

-- 1. Main incomes table
CREATE TABLE IF NOT EXISTS "incomes" (
    "id" BIGSERIAL PRIMARY KEY,
    "tenant_id" TEXT,
    "branch_id" BIGINT,
    "title" TEXT NOT NULL DEFAULT 'Pemasukan',
    "category" TEXT NOT NULL DEFAULT 'Operasional',
    "income_number" TEXT,
    "income_date" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(65,30),
    "pic_name" TEXT,
    "payment_status" "PaymentStatusEnum" DEFAULT 'Paid',
    "notes" TEXT,
    "attachment_url" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,
    "void_reason" TEXT,
    "voided_at" TIMESTAMPTZ(6)
);

-- Unique on income_number (nullable unique)
CREATE UNIQUE INDEX IF NOT EXISTS "incomes_income_number_key"
    ON "incomes" ("income_number");

-- Standard Prisma indexes
CREATE INDEX IF NOT EXISTS "incomes_tenant_id_idx"
    ON "incomes" ("tenant_id");

CREATE INDEX IF NOT EXISTS "incomes_branch_id_idx"
    ON "incomes" ("branch_id");

CREATE INDEX IF NOT EXISTS "incomes_tenant_id_income_date_idx"
    ON "incomes" ("tenant_id", "income_date");

CREATE INDEX IF NOT EXISTS "incomes_tenant_id_payment_status_idx"
    ON "incomes" ("tenant_id", "payment_status");

-- 2. Many-to-one attachments with cascade delete on income removal
CREATE TABLE IF NOT EXISTS "income_attachments" (
    "id" BIGSERIAL PRIMARY KEY,
    "income_id" BIGINT NOT NULL,
    "tenant_id" TEXT,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "income_attachments_income_id_fkey"
        FOREIGN KEY ("income_id") REFERENCES "incomes"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "income_attachments_income_id_idx"
    ON "income_attachments" ("income_id");

CREATE INDEX IF NOT EXISTS "income_attachments_tenant_id_idx"
    ON "income_attachments" ("tenant_id");
