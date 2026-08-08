-- Drop chk_expense_status constraint if it exists on public.expenses table.
-- This constraint was added manually outside of migration tracking and
-- conflicts with allowed status values ('ACTIVE' | 'VOID' | 'PENDING')
-- defined in the application layer (Zod validation + backend defaults).
ALTER TABLE IF EXISTS "expenses" DROP CONSTRAINT IF EXISTS "chk_expense_status";
ALTER TABLE IF EXISTS "public"."expenses" DROP CONSTRAINT IF EXISTS "chk_expense_status";
