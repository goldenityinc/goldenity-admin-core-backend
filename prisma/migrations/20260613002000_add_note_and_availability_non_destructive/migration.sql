-- Safe additive migration for shared production DB.
-- Add product availability and sales item note without destructive changes.
ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "is_available" BOOLEAN DEFAULT true;

ALTER TABLE "sales_record_items"
ADD COLUMN IF NOT EXISTS "note" TEXT;
