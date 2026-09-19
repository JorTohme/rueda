ALTER TABLE drivers ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS drivers_user_id_idx ON drivers (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS settlement_rules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fixed_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  revenue_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (revenue_percent >= 0 AND revenue_percent <= 100),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS settlement_rules_lookup_idx ON settlement_rules (tenant_id, driver_id, vehicle_id, valid_from DESC);

CREATE TABLE IF NOT EXISTS settlements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE RESTRICT,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'closed', 'paid', 'collected')),
  gross_income NUMERIC(14, 2) NOT NULL DEFAULT 0,
  driver_expenses NUMERIC(14, 2) NOT NULL DEFAULT 0,
  fixed_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  revenue_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  owner_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  driver_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (tenant_id, driver_id, vehicle_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS settlements_tenant_period_idx ON settlements (tenant_id, period_end DESC);
CREATE INDEX IF NOT EXISTS settlements_driver_idx ON settlements (tenant_id, driver_id, period_end DESC);
