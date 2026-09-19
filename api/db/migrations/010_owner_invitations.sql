CREATE TABLE IF NOT EXISTS owner_invitations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(email) AND length(trim(email)) > 3),
  organization_name TEXT NOT NULL CHECK (length(trim(organization_name)) BETWEEN 2 AND 80),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_invitations_email_idx
  ON owner_invitations (email, status, created_at DESC);

CREATE INDEX IF NOT EXISTS owner_invitations_expires_at_idx
  ON owner_invitations (expires_at)
  WHERE status = 'pending';
