-- Add mechanic_id and employee_id to sales_record_items
ALTER TABLE "sales_record_items" ADD COLUMN "mechanic_id" VARCHAR(255);
ALTER TABLE "sales_record_items" ADD COLUMN "employee_id" VARCHAR(255);

-- Add indexes for performance
CREATE INDEX "idx_sales_record_items_mechanic_id" ON "sales_record_items"("mechanic_id");
CREATE INDEX "idx_sales_record_items_employee_id" ON "sales_record_items"("employee_id");
