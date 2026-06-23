-- Non-destructive UoM migration for legacy environments with drift.
ALTER TABLE products
ADD COLUMN IF NOT EXISTS unit VARCHAR(255) DEFAULT 'pcs';

UPDATE products
SET unit = 'pcs'
WHERE unit IS NULL OR BTRIM(unit) = '';
