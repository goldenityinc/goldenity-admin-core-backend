-- ============================================================
-- Migration: add_device_and_order_ack
-- Created: 2026-08-06
-- Description: Add branch_devices table, order_acknowledgements table,
--              and new fields to sales_records table for device sync
--              and order acknowledgement tracking.
-- ============================================================

-- -----------------------------------------------------------
-- 1. CREATE ENUM TYPES (IF NOT EXISTS)
-- -----------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'devicerole') THEN
        CREATE TYPE "DeviceRole" AS ENUM (
            'CASHIER',
            'CHECKER_PRINTER',
            'BOTH'
        );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ackstatus') THEN
        CREATE TYPE "AckStatus" AS ENUM (
            'PENDING_ACK',
            'POS_ACKNOWLEDGED',
            'POS_PRINTED',
            'FAILED_DELIVERY',
            'TIMEOUT'
        );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'syncstatus') THEN
        CREATE TYPE "SyncStatus" AS ENUM (
            'DRAFT',
            'QUEUED_FOR_POS',
            'PENDING_ACK',
            'POS_ACKNOWLEDGED',
            'POS_PRINTED',
            'FAILED_DELIVERY'
        );
    END IF;
END$$;

-- -----------------------------------------------------------
-- 2. CREATE TABLE branch_devices (IF NOT EXISTS)
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS "branch_devices" (
    "id"                    BIGSERIAL PRIMARY KEY,
    "tenant_id"             VARCHAR(255)    NOT NULL,
    "branch_id"             BIGINT,
    "device_uuid"           VARCHAR(255)    NOT NULL,
    "mac_address"           VARCHAR(255),
    "device_name"           VARCHAR(255)    NOT NULL,
    "device_role"           "DeviceRole"    NOT NULL,
    "printer_target_id"     VARCHAR(255),
    "is_default_printer"    BOOLEAN         NOT NULL DEFAULT FALSE,
    "is_active"             BOOLEAN         NOT NULL DEFAULT TRUE,
    "last_seen_at"          TIMESTAMPTZ(6),
    "created_at"            TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint on device_uuid (IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'branch_devices_device_uuid_key'
    ) THEN
        ALTER TABLE "branch_devices"
            ADD CONSTRAINT "branch_devices_device_uuid_key"
            UNIQUE ("device_uuid");
    END IF;
END$$;

-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "branch_devices_tenant_id_idx"
    ON "branch_devices" ("tenant_id");

CREATE INDEX IF NOT EXISTS "branch_devices_branch_id_idx"
    ON "branch_devices" ("branch_id");

CREATE INDEX IF NOT EXISTS "branch_devices_tenant_id_is_default_printer_idx"
    ON "branch_devices" ("tenant_id", "is_default_printer");

-- Foreign key: tenant_id -> tenants.id (cascade delete)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'branch_devices_tenant_id_fkey'
    ) THEN
        ALTER TABLE "branch_devices"
            ADD CONSTRAINT "branch_devices_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;

-- Foreign key: branch_id -> branches.id (set null)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'branch_devices_branch_id_fkey'
    ) THEN
        ALTER TABLE "branch_devices"
            ADD CONSTRAINT "branch_devices_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;

-- -----------------------------------------------------------
-- 3. CREATE TABLE order_acknowledgements (IF NOT EXISTS)
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS "order_acknowledgements" (
    "id"                    BIGSERIAL PRIMARY KEY,
    "tenant_id"             VARCHAR(255)    NOT NULL,
    "branch_id"             BIGINT,
    "sales_record_id"       BIGINT,
    "transaction_number"    VARCHAR(255),
    "submission_id"         VARCHAR(255),
    "target_device_uuid"    VARCHAR(255),
    "ack_status"            "AckStatus"     NOT NULL DEFAULT 'PENDING_ACK',
    "retries_count"         INTEGER         NOT NULL DEFAULT 0,
    "first_queued_at"       TIMESTAMPTZ(6),
    "acknowledged_at"       TIMESTAMPTZ(6),
    "printed_at"            TIMESTAMPTZ(6),
    "last_error"            TEXT,
    "ack_payload"           JSONB,
    "created_at"            TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint on submission_id (IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'order_acknowledgements_submission_id_key'
    ) THEN
        ALTER TABLE "order_acknowledgements"
            ADD CONSTRAINT "order_acknowledgements_submission_id_key"
            UNIQUE ("submission_id");
    END IF;
END$$;

-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "order_acknowledgements_tenant_id_idx"
    ON "order_acknowledgements" ("tenant_id");

CREATE INDEX IF NOT EXISTS "order_acknowledgements_submission_id_idx"
    ON "order_acknowledgements" ("submission_id");

CREATE INDEX IF NOT EXISTS "order_acknowledgements_sales_record_id_idx"
    ON "order_acknowledgements" ("sales_record_id");

CREATE INDEX IF NOT EXISTS "order_acknowledgements_ack_status_tenant_id_idx"
    ON "order_acknowledgements" ("ack_status", "tenant_id");

-- Foreign key: tenant_id -> tenants.id (cascade delete)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'order_acknowledgements_tenant_id_fkey'
    ) THEN
        ALTER TABLE "order_acknowledgements"
            ADD CONSTRAINT "order_acknowledgements_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;

-- Foreign key: branch_id -> branches.id (set null)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'order_acknowledgements_branch_id_fkey'
    ) THEN
        ALTER TABLE "order_acknowledgements"
            ADD CONSTRAINT "order_acknowledgements_branch_id_fkey"
            FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;

-- Foreign key: sales_record_id -> sales_records.id (set null)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'order_acknowledgements_sales_record_id_fkey'
    ) THEN
        ALTER TABLE "order_acknowledgements"
            ADD CONSTRAINT "order_acknowledgements_sales_record_id_fkey"
            FOREIGN KEY ("sales_record_id") REFERENCES "sales_records"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;

-- -----------------------------------------------------------
-- 4. ALTER TABLE sales_records - ADD NEW COLUMNS (IF NOT EXISTS)
-- -----------------------------------------------------------

-- target_device_uuid column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sales_records'
          AND column_name = 'target_device_uuid'
    ) THEN
        ALTER TABLE "sales_records"
            ADD COLUMN "target_device_uuid" VARCHAR(255);
    END IF;
END$$;

-- submission_id column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sales_records'
          AND column_name = 'submission_id'
    ) THEN
        ALTER TABLE "sales_records"
            ADD COLUMN "submission_id" VARCHAR(255);
    END IF;
END$$;

-- sync_status column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sales_records'
          AND column_name = 'sync_status'
    ) THEN
        ALTER TABLE "sales_records"
            ADD COLUMN "sync_status" "SyncStatus";
    END IF;
END$$;

-- Unique constraint on submission_id (IF NOT EXISTS)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sales_records_submission_id_key'
    ) THEN
        ALTER TABLE "sales_records"
            ADD CONSTRAINT "sales_records_submission_id_key"
            UNIQUE ("submission_id");
    END IF;
END$$;

-- Index on submission_id (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "sales_records_submission_id_idx"
    ON "sales_records" ("submission_id");
