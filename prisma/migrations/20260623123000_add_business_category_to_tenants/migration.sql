DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'BusinessCategory'
  ) THEN
    CREATE TYPE "BusinessCategory" AS ENUM (
      'GENERAL',
      'RETAIL_FNB',
      'SERVICES_AUTOMOTIVE'
    );
  END IF;
END
$$;

ALTER TABLE "tenants"
ADD COLUMN IF NOT EXISTS "business_category" "BusinessCategory" NOT NULL DEFAULT 'GENERAL';

UPDATE "tenants"
SET "business_category" = 'GENERAL'
WHERE "business_category" IS NULL;
