ALTER TABLE products
ADD COLUMN IF NOT EXISTS branch_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_products_branch_id
ON products(branch_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_branch_id_fkey'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_branch_id_fkey
    FOREIGN KEY (branch_id)
    REFERENCES branches(id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
