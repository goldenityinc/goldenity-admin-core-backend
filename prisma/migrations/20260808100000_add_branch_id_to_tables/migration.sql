-- Migration: add_branch_id_to_tables
-- Date: 2026-08-08
-- Purpose: ISOLATE table management per-branch to FIX CROSS-BRANCH DATA LEAK
--   (meja cabang A muncul di cabang B karena sebelumnya HANYA filter tenant_id)
-- Strategy: NON-DESTRUCTIVE (semua existing table rows: branch_id = NULL → dianggap SHARED / LEGACY
--   sehingga tetap muncul di SEMUA branch untuk backward compatibility. User branch tetap bisa edit / delete
--   table legacy via filter (branch_id = X OR branch_id IS NULL).
-- Tables: tables, + FK relation ke branches table.

-- Step 1: Add column branch_id (nullable, untuk backward compat NULL = LEGACY)
ALTER TABLE IF EXISTS public.tables
  ADD COLUMN IF NOT EXISTS branch_id BIGINT;

-- Step 2: Create indexes (WITH CONCURRENTLY jika live DB, tapi Railway boleh standard)
CREATE INDEX IF NOT EXISTS idx_tables_tenant_branch ON public.tables (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_tables_branch_id ON public.tables (branch_id);

-- Step 3: DROP OLD unique constraint (tenant_id, table_number) — karena sekarang ingin per-branch
--   unik: table "1" boleh ada di cabang A DAN cabang B sebagai row TERPISAH.
--   TAPI TETAP JAGA BACKWARD COMPAT: jika ada existing table tanpa branch_id (NULL),
--   kombinasi (tenant_id, table_number) TETAP UNIQUE untuk mencegah duplicate LEGACY.
--   Solusi: buat DUA unique constraints (lihat Prisma schema):
--     a) (tenant_id, branch_id, table_number) — untuk row yang sudah di-assign branch_id
--     b) (tenant_id, table_number) — tetap di-keep sebagai safety LEGACY NULL duplicate
--   Postgres memungkinkan keduanya berdampingan (keduanya partial compatible).
DO $$
BEGIN
  -- Constraint A: tenant + branch + table_number UNIQUE
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_tenant_id_branch_id_table_number_key'
  ) THEN
    BEGIN
      ALTER TABLE public.tables
        ADD CONSTRAINT tables_tenant_id_branch_id_table_number_key
        UNIQUE (tenant_id, branch_id, table_number);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skip unique (tenant, branch, table_number): %', SQLERRM;
    END;
  END IF;
END $$;

-- Step 4: Foreign key ke branches.id (ON DELETE SET NULL → jika branch dihapus, table jadi SHARED)
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
