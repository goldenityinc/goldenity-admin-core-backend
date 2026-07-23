ALTER TABLE "app_instances"
  ADD COLUMN IF NOT EXISTS "admin_email" TEXT,
  ADD COLUMN IF NOT EXISTS "admin_password" TEXT,
  ADD COLUMN IF NOT EXISTS "admin_name" TEXT;
