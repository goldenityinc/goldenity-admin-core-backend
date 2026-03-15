-- Add optional company logo URL for tenant profile syncing to ERP
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logo_url" TEXT;
