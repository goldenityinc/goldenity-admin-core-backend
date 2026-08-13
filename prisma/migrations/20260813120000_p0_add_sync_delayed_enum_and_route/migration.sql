-- P0 FIX: Bridge -> Admin Core sync-status handler (GAP G1).
-- Tambahkan SYNC_DELAYED value ke enum SyncStatus.
-- Supaya PostgreSQL bisa jalankan ini idempotent tanpa error.
DO $$
BEGIN
  ALTER TYPE "SyncStatus" ADD VALUE IF NOT EXISTS 'SYNC_DELAYED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN RAISE NOTICE 'Enum alter skipped, already applied? err=%', SQLERRM;
END $$;
