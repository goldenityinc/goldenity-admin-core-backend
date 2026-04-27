CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "app_users" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "username" TEXT NOT NULL,
    "password" TEXT,
    "name" TEXT,
    "role" TEXT,
    "custom_role_id" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "categories" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "category_type" TEXT NOT NULL DEFAULT 'PRODUCT',

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "custom_roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customers" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "total_spent" DOUBLE PRECISION DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "daily_cash" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "amount" DECIMAL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_cash_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "expenses" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "amount" DECIMAL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,
    "void_reason" TEXT,
    "voided_at" TIMESTAMPTZ(6),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kas_bon" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kas_bon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "kas_bon_payment_history" (
    "id" BIGSERIAL NOT NULL,
    "sales_record_id" BIGINT NOT NULL,
    "paid_amount" DECIMAL(14, 2) NOT NULL,
    "previous_balance" DECIMAL(14, 2) NOT NULL,
    "remaining_balance" DECIMAL(14, 2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT,
    "payment_method" TEXT,
    "paid_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "kas_bon_payment_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_history" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "supplier_phone" TEXT,
    "message_body" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_history_items" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "order_history_id" BIGINT,
    "is_manual" BOOLEAN DEFAULT false,
    "product_id" BIGINT,
    "manual_item_id" BIGINT,
    "item_name" TEXT NOT NULL,
    "qty" INTEGER DEFAULT 1,
    "notes" TEXT,
    "supplier_name" TEXT,
    "ordered_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "is_archived" BOOLEAN DEFAULT false,
    "is_received" BOOLEAN DEFAULT false,
    "received_at" TIMESTAMP(3),
    "received_qty" INTEGER,
    "received_purchase_price" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_history_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "petty_cash_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT,
    "user_id" TEXT,
    "amount" INTEGER,
    "type" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "user_name" TEXT,

    CONSTRAINT "petty_cash_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "category" TEXT,
    "price" DOUBLE PRECISION DEFAULT 0,
    "purchase_price" DOUBLE PRECISION,
    "stock" INTEGER DEFAULT 0,
    "is_service" BOOLEAN DEFAULT false,
    "supplier_name" TEXT,
    "image_url" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "reference_id" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "restock_history" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restock_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_record_items" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "sales_record_id" BIGINT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "custom_price" DECIMAL(14, 2),
    "note" TEXT,
    "is_service" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_record_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_records" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "reference_id" TEXT,
    "payment_method" TEXT,
    "payment_type" TEXT,
    "total_price" DECIMAL,
    "total_amount" DECIMAL,
    "remaining_balance" DECIMAL,
    "outstanding_balance" DECIMAL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "receipt_number" TEXT,
    "cashier_id" TEXT,
    "cashier_name" TEXT,
    "payment_status" TEXT,
    "items_json" JSONB,
    "customer_name" TEXT,
    "total_discount" BIGINT,
    "total_tax" BIGINT,
    "total_profit" BIGINT,
    "amount_paid" DECIMAL DEFAULT 0,

    CONSTRAINT "sales_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "device_type" TEXT NOT NULL,
    "device_brand" TEXT,
    "serial_number" TEXT,
    "complaint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "estimated_cost" DECIMAL(14, 2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "technician_notes" TEXT,
    "service_details" JSONB,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "store_settings" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "key" TEXT,
    "value" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "transactions" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_roles_tenant_id_name_key" ON "custom_roles"("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "app_users_tenant_id_idx" ON "app_users"("tenant_id");
CREATE INDEX IF NOT EXISTS "app_users_username_idx" ON "app_users"("username");
CREATE INDEX IF NOT EXISTS "categories_tenant_id_idx" ON "categories"("tenant_id");
CREATE INDEX IF NOT EXISTS "custom_roles_tenant_id_idx" ON "custom_roles"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_custom_roles_is_default" ON "custom_roles"("is_default");
CREATE INDEX IF NOT EXISTS "idx_custom_roles_tenant_id" ON "custom_roles"("tenant_id");
CREATE INDEX IF NOT EXISTS "customers_tenant_id_idx" ON "customers"("tenant_id");
CREATE INDEX IF NOT EXISTS "daily_cash_tenant_id_idx" ON "daily_cash"("tenant_id");
CREATE INDEX IF NOT EXISTS "expenses_tenant_id_idx" ON "expenses"("tenant_id");
CREATE INDEX IF NOT EXISTS "kas_bon_tenant_id_idx" ON "kas_bon"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_kas_bon_payment_history_sales_record_id" ON "kas_bon_payment_history"("sales_record_id");
CREATE INDEX IF NOT EXISTS "idx_kas_bon_payment_history_tenant_id" ON "kas_bon_payment_history"("tenant_id");
CREATE INDEX IF NOT EXISTS "order_history_tenant_id_idx" ON "order_history"("tenant_id");
CREATE INDEX IF NOT EXISTS "order_history_items_order_history_id_idx" ON "order_history_items"("order_history_id");
CREATE INDEX IF NOT EXISTS "order_history_items_tenant_id_idx" ON "order_history_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_petty_cash_logs_created_at" ON "petty_cash_logs"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_petty_cash_logs_tenant_created_at" ON "petty_cash_logs"("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "petty_cash_logs_tenant_id_created_at_idx" ON "petty_cash_logs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "petty_cash_logs_tenant_id_idx" ON "petty_cash_logs"("tenant_id");
CREATE INDEX IF NOT EXISTS "petty_cash_logs_user_id_idx" ON "petty_cash_logs"("user_id");
CREATE INDEX IF NOT EXISTS "products_tenant_id_idx" ON "products"("tenant_id");
CREATE INDEX IF NOT EXISTS "restock_history_tenant_id_idx" ON "restock_history"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sales_record_items_sales_record_id" ON "sales_record_items"("sales_record_id");
CREATE INDEX IF NOT EXISTS "idx_sales_record_items_tenant_id" ON "sales_record_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "sales_records_reference_id_idx" ON "sales_records"("reference_id");
CREATE INDEX IF NOT EXISTS "sales_records_tenant_id_idx" ON "sales_records"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_service_orders_created_at" ON "service_orders"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_service_orders_tenant_id" ON "service_orders"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_service_orders_tenant_status" ON "service_orders"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "service_orders_created_at_idx" ON "service_orders"("created_at");
CREATE INDEX IF NOT EXISTS "service_orders_tenant_id_idx" ON "service_orders"("tenant_id");
CREATE INDEX IF NOT EXISTS "service_orders_tenant_id_status_idx" ON "service_orders"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "store_settings_tenant_id_idx" ON "store_settings"("tenant_id");
CREATE INDEX IF NOT EXISTS "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");
CREATE INDEX IF NOT EXISTS "transactions_tenant_id_idx" ON "transactions"("tenant_id");