-- ============================================================
-- MANUAL SQL: Run via Railway Data Editor / psql
-- Fix Cross-Branch Table Leak (MEJA CABANG A MUNCUL DI CABANG B)
-- ============================================================
-- Step 1: Add nullable column (NO DOWNTIME — existing rows = NULL = LEGACY SHARED)
ALTER TABLE IF EXISTS public.tables
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

-- Step 2: Indexes for fast filter tenant_id + branch_id
CREATE INDEX IF NOT EXISTS idx_tables_tenant_branch ON public.tables (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_tables_branch_id ON public.tables (branch_id);

-- Step 3: Unique constraint (tenant + branch + table_number) → meja "1" boleh beda per branch
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_tenant_id_branch_id_table_number_key'
  ) THEN
    BEGIN
      ALTER TABLE public.tables
        ADD CONSTRAINT tables_tenant_id_branch_id_table_number_key
        UNIQUE (tenant_id, branch_id, table_number);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip add unique (tenant,branch,table): %', SQLERRM;
    END;
  END IF;
END $$;

-- Step 4: Foreign key (ON DELETE SET NULL = branch dihapus → table jadi SHARED legacy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_branch_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.tables
        ADD CONSTRAINT tables_branch_id_fkey
        FOREIGN KEY (branch_id) REFERENCES public.branches (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip FK tables_branch_id_fkey: %', SQLERRM;
    END;
  END IF;
END $$;

-- ============================================================
-- OPTIONAL (Step 5): Backfill existing tables ke branch PERTAMA (MAIN BRANCH)
--   Jika Anda ingin SEMUA existing table TIDAK SHARED, tapi jadi MILIK branch utama tenant:
-- ============================================================
-- DO $$
-- DECLARE
--   r RECORD;
-- BEGIN
--   FOR r IN
--     SELECT t.id AS table_id, t.tenant_id,
--            (SELECT id FROM branches WHERE tenantId = t.tenant_id ORDER BY "isMainBranch" DESC, id ASC LIMIT 1) AS main_branch_id
--     FROM tables t
--     WHERE t.branch_id IS NULL
--   LOOP
--     IF r.main_branch_id IS NOT NULL THEN
--       UPDATE tables SET branch_id = r.main_branch_id WHERE id = r.table_id;
--     END IF;
--   END LOOP;
-- END $$;
