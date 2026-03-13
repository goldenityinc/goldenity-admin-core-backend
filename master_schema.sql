-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabel User & Versi Aplikasi
CREATE TABLE IF NOT EXISTS app_users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_versions (
    id SERIAL PRIMARY KEY,
    version_number TEXT NOT NULL,
    release_date DATE,
    release_notes TEXT NOT NULL
);

-- 2. Tabel Produk & Kategori
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    barcode TEXT,
    category TEXT NOT NULL,
    price BIGINT NOT NULL,
    purchase_price BIGINT,
    stock INTEGER NOT NULL,
    status_belanja TEXT,
    is_active BOOLEAN DEFAULT true,
    is_service BOOLEAN DEFAULT false,
    is_ordered BOOLEAN DEFAULT false,
    supplier_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabel Supplier & Settings
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    nama_toko TEXT NOT NULL,
    kontak TEXT,
    alamat TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_settings (
    id SERIAL PRIMARY KEY,
    store_name TEXT,
    address TEXT,
    npwp TEXT,
    logo_url TEXT,
    apply_tax BOOLEAN DEFAULT false,
    is_tax_exclusive BOOLEAN DEFAULT false,
    subscription_tier TEXT NOT NULL,
    paper_size TEXT
);

-- Seed default store settings row (idempotent)
INSERT INTO store_settings (
    id,
    store_name,
    address,
    npwp,
    logo_url,
    apply_tax,
    is_tax_exclusive,
    subscription_tier,
    paper_size
)
SELECT
    1,
    'Point of Sales',
    '-',
    '-',
    NULL,
    false,
    true,
    'Standard',
    'roll57'
WHERE NOT EXISTS (
    SELECT 1 FROM store_settings WHERE id = 1
);

-- 4. Tabel Transaksi & Penjualan
CREATE TABLE IF NOT EXISTS sales_records (
    id SERIAL PRIMARY KEY,
    receipt_number TEXT,
    customer_name TEXT,
    total_price BIGINT NOT NULL,
    total_discount BIGINT,
    total_tax BIGINT,
    total_profit BIGINT,
    payment_method TEXT,
    payment_status TEXT NOT NULL,
    status TEXT,
    void_reason TEXT,
    items JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tabel Operasional (Cash & Expenses)
CREATE TABLE IF NOT EXISTS daily_cash (
    id SERIAL PRIMARY KEY,
    tanggal DATE NOT NULL,
    modal_awal NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    category TEXT NOT NULL,
    expense_date DATE NOT NULL,
    expense_number TEXT,
    payment_method TEXT,
    status TEXT,
    void_reason TEXT,
    attachment_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Tabel Histori Order (Pengadaan Barang)
CREATE TABLE IF NOT EXISTS order_history (
    id BIGSERIAL PRIMARY KEY,
    supplier_name TEXT NOT NULL,
    supplier_phone TEXT,
    message_body TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_history_items (
    id BIGSERIAL PRIMARY KEY,
    order_history_id BIGINT NOT NULL,
    product_id BIGINT,
    item_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    notes TEXT,
    supplier_name TEXT,
    is_manual BOOLEAN NOT NULL,
    is_archived BOOLEAN NOT NULL,
    ordered_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Tabel Belanja & Cart
CREATE TABLE IF NOT EXISTS saved_carts (
    id SERIAL PRIMARY KEY,
    customer_name TEXT NOT NULL,
    items JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manual_shopping_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name TEXT NOT NULL,
    qty INTEGER,
    notes TEXT,
    is_purchased BOOLEAN,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
