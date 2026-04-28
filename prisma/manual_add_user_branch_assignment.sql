ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_branch_id_fkey'
  ) THEN
    ALTER TABLE public.users
    ADD CONSTRAINT users_branch_id_fkey
    FOREIGN KEY (branch_id)
    REFERENCES public.branches(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_branch_id
ON public.users(branch_id);