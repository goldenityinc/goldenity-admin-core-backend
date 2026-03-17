-- Add logo object key to support private storage + public proxy URLs
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logo_object_key" TEXT;
