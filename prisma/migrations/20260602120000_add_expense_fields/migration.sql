-- AddField title to expenses
ALTER TABLE "expenses" ADD COLUMN "title" VARCHAR(255);

-- AddField category to expenses  
ALTER TABLE "expenses" ADD COLUMN "category" VARCHAR(100);

-- AddField expense_date to expenses
ALTER TABLE "expenses" ADD COLUMN "expense_date" TIMESTAMP(3);

-- Set defaults for existing records
UPDATE "expenses" SET "title" = 'Pengeluaran' WHERE "title" IS NULL;
UPDATE "expenses" SET "expense_date" = "created_at" WHERE "expense_date" IS NULL;
UPDATE "expenses" SET "category" = 'Operasional' WHERE "category" IS NULL;

-- Make fields NOT NULL after setting defaults
ALTER TABLE "expenses" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "expense_date" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "category" SET NOT NULL;
