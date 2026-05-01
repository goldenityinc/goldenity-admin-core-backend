-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "shifts" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "branch_id" BIGINT NOT NULL,
  "user_id" TEXT NOT NULL,
  "start_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "end_time" TIMESTAMP(3),
  "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
  "starting_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "expected_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actual_cash" DECIMAL(14,2),
  "difference_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "expected_qris" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actual_qris" DECIMAL(14,2),
  "difference_qris" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "expected_transfer" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "actual_transfer" DECIMAL(14,2),
  "difference_transfer" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "sales_records"
ADD COLUMN "shift_id" BIGINT;

-- CreateIndex
CREATE INDEX "shifts_tenant_id_idx" ON "shifts"("tenant_id");

-- CreateIndex
CREATE INDEX "shifts_branch_id_idx" ON "shifts"("branch_id");

-- CreateIndex
CREATE INDEX "shifts_user_id_idx" ON "shifts"("user_id");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_branch_id_user_id_status_idx" ON "shifts"("tenant_id", "branch_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "sales_records_shift_id_idx" ON "sales_records"("shift_id");

-- AddForeignKey
ALTER TABLE "shifts"
ADD CONSTRAINT "shifts_branch_id_fkey"
FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts"
ADD CONSTRAINT "shifts_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_records"
ADD CONSTRAINT "sales_records_shift_id_fkey"
FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
