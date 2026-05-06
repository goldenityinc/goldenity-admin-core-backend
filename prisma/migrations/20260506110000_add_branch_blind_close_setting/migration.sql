-- AlterTable
ALTER TABLE "branches"
ADD COLUMN "is_blind_close_enabled" BOOLEAN NOT NULL DEFAULT true;
