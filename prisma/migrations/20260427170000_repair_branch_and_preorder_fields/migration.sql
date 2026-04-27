DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderType') THEN
    CREATE TYPE "OrderType" AS ENUM ('WALK_IN', 'PRE_ORDER', 'DELIVERY');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
    CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "branches" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_record_items"
ADD COLUMN IF NOT EXISTS "is_custom_item" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "custom_name" TEXT;

ALTER TABLE "sales_records"
ADD COLUMN IF NOT EXISTS "branch_id" BIGINT,
ADD COLUMN IF NOT EXISTS "order_type" "OrderType" NOT NULL DEFAULT 'WALK_IN',
ADD COLUMN IF NOT EXISTS "order_status" "OrderStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN IF NOT EXISTS "pickup_date" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "target_pickup_branch_id" BIGINT;

CREATE INDEX IF NOT EXISTS "branches_tenant_id_idx" ON "branches"("tenant_id");
CREATE INDEX IF NOT EXISTS "branches_tenant_id_is_active_idx" ON "branches"("tenant_id", "is_active");
CREATE INDEX IF NOT EXISTS "sales_records_branch_id_idx" ON "sales_records"("branch_id");
CREATE INDEX IF NOT EXISTS "sales_records_target_pickup_branch_id_idx" ON "sales_records"("target_pickup_branch_id");
CREATE INDEX IF NOT EXISTS "sales_records_order_type_idx" ON "sales_records"("order_type");
CREATE INDEX IF NOT EXISTS "sales_records_order_status_idx" ON "sales_records"("order_status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'branches_tenant_id_fkey'
  ) THEN
    ALTER TABLE "branches"
      ADD CONSTRAINT "branches_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_records_branch_id_fkey'
  ) THEN
    ALTER TABLE "sales_records"
      ADD CONSTRAINT "sales_records_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_records_target_pickup_branch_id_fkey'
  ) THEN
    ALTER TABLE "sales_records"
      ADD CONSTRAINT "sales_records_target_pickup_branch_id_fkey"
      FOREIGN KEY ("target_pickup_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;