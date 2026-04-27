-- Remove DEPLOYING from AppInstanceStatus enum and normalize existing data.

-- 1) Normalize existing rows.
UPDATE "app_instances"
SET "status" = 'ACTIVE'
WHERE "status" = 'DEPLOYING';

-- 2) Create a new enum without DEPLOYING.
CREATE TYPE "AppInstanceStatus_new" AS ENUM ('ACTIVE', 'SUSPENDED');

-- 3) Drop default before altering type (safe in case default references removed value).
ALTER TABLE "app_instances" ALTER COLUMN "status" DROP DEFAULT;

-- 4) Alter column type to the new enum.
ALTER TABLE "app_instances"
  ALTER COLUMN "status" TYPE "AppInstanceStatus_new"
  USING ("status"::text::"AppInstanceStatus_new");

-- 5) Replace the old enum type.
DROP TYPE "AppInstanceStatus";
ALTER TYPE "AppInstanceStatus_new" RENAME TO "AppInstanceStatus";

-- 6) Re-apply default.
ALTER TABLE "app_instances" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
