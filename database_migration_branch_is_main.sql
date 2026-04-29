-- Add is_main_branch for multi-branch main branch labeling
ALTER TABLE "branches"
ADD COLUMN IF NOT EXISTS "is_main_branch" BOOLEAN NOT NULL DEFAULT FALSE;
