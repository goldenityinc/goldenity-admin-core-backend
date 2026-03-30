-- Add addons array column for hybrid subscription model (base tier + add-ons)
ALTER TABLE "app_instances"
ADD COLUMN IF NOT EXISTS "addons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
