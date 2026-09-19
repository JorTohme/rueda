CREATE TABLE IF NOT EXISTS driver_invitations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email) AND length(trim(email)) > 3),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_invitations_lookup_idx
  ON driver_invitations (tenant_id, driver_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS driver_invitations_pending_email_idx
  ON driver_invitations (tenant_id, driver_id, email)
  WHERE status = 'pending';
