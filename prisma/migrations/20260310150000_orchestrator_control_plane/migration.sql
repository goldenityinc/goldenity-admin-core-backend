-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "AppInstanceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEPLOYING');

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER');

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('SUPER_ADMIN', 'TENANT_ADMIN', 'CRM_MANAGER', 'CRM_STAFF', 'READ_ONLY');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CRM_STAFF';
COMMIT;

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_tenantId_fkey";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CRM_STAFF';

-- DropTable
DROP TABLE "products";

-- DropTable
DROP TABLE "categories";

-- CreateTable
CREATE TABLE "solutions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "solutionId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "status" "AppInstanceStatus" NOT NULL DEFAULT 'DEPLOYING',
    "dbConnectionString" TEXT,
    "appUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_app_accesses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appInstanceId" TEXT NOT NULL,
    "role" "AppRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_app_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solutions_code_key" ON "solutions"("code");

-- CreateIndex
CREATE INDEX "solutions_code_idx" ON "solutions"("code");

-- CreateIndex
CREATE INDEX "app_instances_tenantId_idx" ON "app_instances"("tenantId");

-- CreateIndex
CREATE INDEX "app_instances_solutionId_idx" ON "app_instances"("solutionId");

-- CreateIndex
CREATE INDEX "app_instances_status_idx" ON "app_instances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "app_instances_tenantId_solutionId_key" ON "app_instances"("tenantId", "solutionId");

-- CreateIndex
CREATE INDEX "user_app_accesses_appInstanceId_idx" ON "user_app_accesses"("appInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_app_accesses_userId_appInstanceId_key" ON "user_app_accesses"("userId", "appInstanceId");

-- AddForeignKey
ALTER TABLE "app_instances" ADD CONSTRAINT "app_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_instances" ADD CONSTRAINT "app_instances_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "solutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_app_accesses" ADD CONSTRAINT "user_app_accesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_app_accesses" ADD CONSTRAINT "user_app_accesses_appInstanceId_fkey" FOREIGN KEY ("appInstanceId") REFERENCES "app_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

