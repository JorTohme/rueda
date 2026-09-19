CREATE TABLE IF NOT EXISTS documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id BIGINT REFERENCES drivers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (length(trim(document_type)) BETWEEN 2 AND 80),
  document_number TEXT,
  issued_on DATE,
  expires_on DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((vehicle_id IS NOT NULL) <> (driver_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS documents_tenant_id_idx ON documents (tenant_id);
CREATE INDEX IF NOT EXISTS documents_vehicle_id_idx ON documents (vehicle_id, expires_on);
CREATE INDEX IF NOT EXISTS documents_driver_id_idx ON documents (driver_id, expires_on);
