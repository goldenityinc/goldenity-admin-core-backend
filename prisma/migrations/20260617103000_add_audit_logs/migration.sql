CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  action_type TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id
  ON audit_logs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_at_desc
  ON audit_logs (tenant_id, created_at DESC);
