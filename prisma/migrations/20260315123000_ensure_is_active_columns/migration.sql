-- Ensure users table has isActive (Prisma camelCase convention)
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;

-- Ensure tenant app_users table (if present) has is_active
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'app_users'
  ) THEN
    EXECUTE 'ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE';
  END IF;
END $$;
