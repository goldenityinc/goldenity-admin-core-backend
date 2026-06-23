-- Manual non-destructive fix for schema drift in production-like DB.
-- 1) Keep expenses.expense_number aligned with existing unique constraint.
ALTER TABLE "expenses"
ADD COLUMN IF NOT EXISTS "expense_number" VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_expense_number_key'
  ) THEN
    ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_expense_number_key" UNIQUE ("expense_number");
  END IF;
END $$;

-- 2) Add QR order note column to transactions.
ALTER TABLE "transactions"
ADD COLUMN IF NOT EXISTS "special_note" TEXT;
