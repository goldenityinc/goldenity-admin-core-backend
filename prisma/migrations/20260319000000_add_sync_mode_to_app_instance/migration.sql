-- Create SyncMode enum type if it does not exist
DO $$ BEGIN
  CREATE TYPE "SyncMode" AS ENUM ('CLOUD_FIRST', 'LOCAL_FIRST', 'LOCAL_SERVER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add sync_mode column to app_instances with a default of CLOUD_FIRST
ALTER TABLE "app_instances" ADD COLUMN IF NOT EXISTS "sync_mode" "SyncMode" NOT NULL DEFAULT 'CLOUD_FIRST';
