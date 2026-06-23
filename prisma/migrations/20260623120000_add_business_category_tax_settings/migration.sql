-- CreateEnum
CREATE TYPE "BusinessCategory" AS ENUM ('GENERAL', 'RETAIL_FNB', 'SERVICES_AUTOMOTIVE');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "business_category" "BusinessCategory",
ADD COLUMN "tax_settings" JSONB;
