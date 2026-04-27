-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('WALK_IN', 'PRE_ORDER', 'DELIVERY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "branches" (
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

-- AlterTable
ALTER TABLE "sales_record_items"
ADD COLUMN "is_custom_item" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "custom_name" TEXT;

-- AlterTable
ALTER TABLE "sales_records"
ADD COLUMN "branch_id" BIGINT,
ADD COLUMN "order_type" "OrderType" NOT NULL DEFAULT 'WALK_IN',
ADD COLUMN "order_status" "OrderStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN "pickup_date" TIMESTAMP(3),
ADD COLUMN "target_pickup_branch_id" BIGINT;

-- CreateIndex
CREATE INDEX "branches_tenant_id_idx" ON "branches"("tenant_id");

-- CreateIndex
CREATE INDEX "branches_tenant_id_is_active_idx" ON "branches"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "sales_records_branch_id_idx" ON "sales_records"("branch_id");

-- CreateIndex
CREATE INDEX "sales_records_target_pickup_branch_id_idx" ON "sales_records"("target_pickup_branch_id");

-- CreateIndex
CREATE INDEX "sales_records_order_type_idx" ON "sales_records"("order_type");

-- CreateIndex
CREATE INDEX "sales_records_order_status_idx" ON "sales_records"("order_status");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_records" ADD CONSTRAINT "sales_records_target_pickup_branch_id_fkey" FOREIGN KEY ("target_pickup_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;