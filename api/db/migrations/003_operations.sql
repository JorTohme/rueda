CREATE TABLE IF NOT EXISTS drivers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drivers_tenant_id_idx ON drivers (tenant_id);

CREATE TABLE IF NOT EXISTS vehicle_driver_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  assigned_from DATE NOT NULL DEFAULT CURRENT_DATE,
  assigned_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (assigned_to IS NULL OR assigned_to >= assigned_from)
);

CREATE INDEX IF NOT EXISTS vehicle_driver_assignments_tenant_id_idx
  ON vehicle_driver_assignments (tenant_id);
CREATE INDEX IF NOT EXISTS vehicle_driver_assignments_vehicle_id_idx
  ON vehicle_driver_assignments (vehicle_id);
CREATE INDEX IF NOT EXISTS vehicle_driver_assignments_driver_id_idx
  ON vehicle_driver_assignments (driver_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_driver_assignments_one_active_driver_idx
  ON vehicle_driver_assignments (tenant_id, driver_id)
  WHERE assigned_to IS NULL;

CREATE TABLE IF NOT EXISTS financial_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  driver_id BIGINT REFERENCES drivers(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 2 AND 80),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  occurred_on DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_movements_tenant_date_idx
  ON financial_movements (tenant_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS financial_movements_vehicle_date_idx
  ON financial_movements (vehicle_id, occurred_on DESC);
