ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS application_slugs TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS tenant_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS tenant_applications_tenant_id_idx
  ON tenant_applications (tenant_id);

INSERT INTO tenant_applications (tenant_id, slug, name)
SELECT t.id, defaults.slug, defaults.name
FROM tenants t
CROSS JOIN (VALUES
  ('uber', 'Uber'),
  ('cabify', 'Cabify'),
  ('maxim', 'Maxim'),
  ('didi', 'DiDi')
) AS defaults(slug, name)
ON CONFLICT (tenant_id, slug) DO NOTHING;
