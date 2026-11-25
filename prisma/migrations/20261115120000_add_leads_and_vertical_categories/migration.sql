-- Growth A1/A3 (15 Nov 2026):
-- 1) Kategori bisnis vertikal baru untuk edisi Bakery/Katering/Florist/Frozen food.
-- 2) Tabel leads untuk pipeline penjualan Super Admin.
-- Ditulis idempotent supaya aman dijalankan ulang oleh `prisma migrate deploy`.

DO $$
BEGIN
  ALTER TYPE "BusinessCategory" ADD VALUE IF NOT EXISTS 'BAKERY';
  ALTER TYPE "BusinessCategory" ADD VALUE IF NOT EXISTS 'CATERING';
  ALTER TYPE "BusinessCategory" ADD VALUE IF NOT EXISTS 'FLORIST';
  ALTER TYPE "BusinessCategory" ADD VALUE IF NOT EXISTS 'FROZEN_FOOD';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'INTERVIEW', 'DEMO', 'TRIAL', 'WON', 'LOST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "leads" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
  "tier" TEXT,
  "score" INTEGER,
  "area" TEXT,
  "address" TEXT,
  "phone" TEXT,
  "instagram" TEXT,
  "rating" DOUBLE PRECISION,
  "review_count" INTEGER,
  "outlet_count" INTEGER,
  "source" TEXT,
  "maps_url" TEXT,
  "notes" TEXT,
  "lost_reason" TEXT,
  "next_follow_up_at" TIMESTAMP(3),
  "last_contacted_at" TIMESTAMP(3),
  "tenant_id" TEXT,
  "dedupe_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "leads_dedupe_key_key" ON "leads"("dedupe_key");
CREATE INDEX IF NOT EXISTS "leads_stage_idx" ON "leads"("stage");
CREATE INDEX IF NOT EXISTS "leads_segment_idx" ON "leads"("segment");
CREATE INDEX IF NOT EXISTS "leads_tenant_id_idx" ON "leads"("tenant_id");
CREATE INDEX IF NOT EXISTS "leads_next_follow_up_at_idx" ON "leads"("next_follow_up_at");
