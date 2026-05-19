ALTER TABLE "users"
	ADD COLUMN IF NOT EXISTS "employee_type" VARCHAR(50) NOT NULL DEFAULT 'Kasir',
	ADD COLUMN IF NOT EXISTS "base_salary" DECIMAL(14, 2) NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS "commission_rate" DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE "products"
	ADD COLUMN IF NOT EXISTS "product_type" VARCHAR(16) NOT NULL DEFAULT 'Barang';

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'products_product_type_allowed_chk'
			AND conrelid = 'products'::regclass
	) THEN
		ALTER TABLE "products"
			ADD CONSTRAINT products_product_type_allowed_chk
			CHECK ("product_type" IN ('Barang', 'Jasa'));
	END IF;
END $$;

ALTER TABLE "transactions"
	ADD COLUMN IF NOT EXISTS "mechanic_id" VARCHAR(64),
	ADD COLUMN IF NOT EXISTS "mechanic_name" VARCHAR(255),
	ADD COLUMN IF NOT EXISTS "mechanic_commission" DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE "sales_records"
	ADD COLUMN IF NOT EXISTS "mechanic_id" VARCHAR(64),
	ADD COLUMN IF NOT EXISTS "mechanic_name" VARCHAR(255),
	ADD COLUMN IF NOT EXISTS "mechanic_commission" DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE "app_users"
	ADD COLUMN IF NOT EXISTS "employee_type" VARCHAR(50) NOT NULL DEFAULT 'Kasir',
	ADD COLUMN IF NOT EXISTS "base_salary" DECIMAL(14, 2) NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS "commission_rate" DECIMAL(14, 2) NOT NULL DEFAULT 0;
