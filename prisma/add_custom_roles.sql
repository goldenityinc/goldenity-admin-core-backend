CREATE TABLE IF NOT EXISTS custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL,
  name        VARCHAR(80) NOT NULL,
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_roles_tenant_id_name_key UNIQUE (tenant_id, name),
  CONSTRAINT custom_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS custom_roles_tenant_id_idx ON custom_roles(tenant_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL;

-- Tambah kolom is_default jika tabel sudah ada tapi kolom belum ada
ALTER TABLE custom_roles ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
