DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'AppModule'
  ) THEN
    CREATE TYPE "AppModule" AS ENUM (
      'module_category_management',
      'module_customer_management',
      'module_custom_rbac',
      'module_dashboard',
      'module_debt_management',
      'module_expense_management',
      'module_finance_reports',
      'module_fnb',
      'module_hardware_devices',
      'module_hr_payroll',
      'module_inventory',
      'module_offline_mode',
      'module_pre_order',
      'module_procurement',
      'module_realtime_sync',
      'module_receipt_printing',
      'module_role_management',
      'module_sales',
      'module_sales_history',
      'module_service_orders',
      'module_service_receipt_printing',
      'module_settings',
      'module_shift_history',
      'module_supplier_management',
      'module_tax_reports',
      'module_user_management',
      'module_workshop_service',
      'ACADEMICS',
      'FINANCE',
      'STUDENTS',
      'BILLING'
    );
  END IF;
END $$;

ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_category_management';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_customer_management';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_custom_rbac';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_dashboard';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_debt_management';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_expense_management';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_finance_reports';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_fnb';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_hardware_devices';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_hr_payroll';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_inventory';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_offline_mode';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_pre_order';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_procurement';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_realtime_sync';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_receipt_printing';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_role_management';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_sales';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_sales_history';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_service_orders';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_service_receipt_printing';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_settings';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_shift_history';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_supplier_management';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_tax_reports';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_user_management';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'module_workshop_service';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'ACADEMICS';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'STUDENTS';
ALTER TYPE "AppModule" ADD VALUE IF NOT EXISTS 'BILLING';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'module_definitions'
      AND column_name = 'module_key'
      AND udt_name <> 'AppModule'
  ) THEN
    ALTER TABLE "module_definitions"
      ALTER COLUMN "module_key" TYPE "AppModule"
      USING ("module_key"::text::"AppModule");
  END IF;
END $$;
