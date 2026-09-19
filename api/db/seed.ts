import { closePool, getPool } from './pool.js'
import { hashPassword } from '../auth.js'

const pool = getPool()

try {
  await pool.query(`
    INSERT INTO tenants (slug, name) VALUES
      ('demo-fleet', 'Flota Norte'),
      ('other-fleet', 'Flota Sur')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  `)

  const demoEmail = (process.env.DEMO_EMAIL ?? 'demo@rueda.local').trim().toLowerCase()
  const demoPassword = process.env.DEMO_PASSWORD ?? 'demo-password'
  const owner = await pool.query<{ id: string }>(`
    INSERT INTO users (email, password_hash) VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id::text
  `, [demoEmail, hashPassword(demoPassword)])
  await pool.query(`
    INSERT INTO memberships (user_id, tenant_id, role)
    SELECT $1, id, 'owner' FROM tenants WHERE slug = 'demo-fleet'
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
  `, [owner.rows[0].id])

  await pool.query(`
    INSERT INTO vehicles (tenant_id, brand, model, license_plate, status)
    SELECT id, $2, $3, $4, $5 FROM tenants WHERE slug = $1
    ON CONFLICT (tenant_id, license_plate) DO UPDATE SET
      brand = EXCLUDED.brand, model = EXCLUDED.model, status = EXCLUDED.status
  `, ['demo-fleet', 'Toyota', 'Etios', 'AA 123 BB', 'active'])

  await pool.query(`
    INSERT INTO vehicles (tenant_id, brand, model, license_plate, status)
    SELECT id, $2, $3, $4, $5 FROM tenants WHERE slug = $1
    ON CONFLICT (tenant_id, license_plate) DO UPDATE SET
      brand = EXCLUDED.brand, model = EXCLUDED.model, status = EXCLUDED.status
  `, ['demo-fleet', 'Fiat', 'Cronos', 'AB 456 CD', 'active'])

  await pool.query(`
    INSERT INTO vehicles (tenant_id, brand, model, license_plate, status)
    SELECT id, $2, $3, $4, $5 FROM tenants WHERE slug = $1
    ON CONFLICT (tenant_id, license_plate) DO UPDATE SET
      brand = EXCLUDED.brand, model = EXCLUDED.model, status = EXCLUDED.status
  `, ['demo-fleet', 'Chevrolet', 'Onix', 'AC 789 DE', 'active'])

  await pool.query(`
    INSERT INTO vehicles (tenant_id, brand, model, license_plate, status)
    SELECT id, $2, $3, $4, $5 FROM tenants WHERE slug = $1
    ON CONFLICT (tenant_id, license_plate) DO UPDATE SET
      brand = EXCLUDED.brand, model = EXCLUDED.model, status = EXCLUDED.status
  `, ['other-fleet', 'Renault', 'Logan', 'ZZ 999 ZZ', 'active'])

  await pool.query(`
    UPDATE vehicles v
    SET application_slugs = ARRAY['uber']::text[]
    FROM tenants t
    WHERE v.tenant_id = t.id AND t.slug = 'demo-fleet'
  `)

  await pool.query(`
    INSERT INTO financial_movements (tenant_id, vehicle_id, kind, category, amount, occurred_on)
    SELECT t.id, v.id, demo.kind, demo.category, demo.amount, CURRENT_DATE
    FROM tenants t
    JOIN vehicles v ON v.tenant_id = t.id
    JOIN (VALUES
      ('AA 123 BB', 'income', 'Demo production Etios', 500000::numeric),
      ('AA 123 BB', 'expense', 'Demo costs Etios', 160000::numeric),
      ('AB 456 CD', 'income', 'Demo production Cronos', 420000::numeric),
      ('AB 456 CD', 'expense', 'Demo costs Cronos', 130000::numeric),
      ('AC 789 DE', 'income', 'Demo production Onix', 330000::numeric),
      ('AC 789 DE', 'expense', 'Demo costs Onix', 100000::numeric)
    ) AS demo(license_plate, kind, category, amount) ON demo.license_plate = v.license_plate
    WHERE t.slug = 'demo-fleet'
      AND NOT EXISTS (SELECT 1 FROM financial_movements f WHERE f.tenant_id = t.id AND f.vehicle_id = v.id AND f.category = demo.category AND f.occurred_on = CURRENT_DATE)
  `)

  await pool.query(`
    UPDATE financial_movements f
    SET application_slug = 'uber', trip_count = CASE f.category
      WHEN 'Demo production Etios' THEN 42
      WHEN 'Demo production Cronos' THEN 36
      WHEN 'Demo production Onix' THEN 28
    END, recipient = 'driver'
    FROM tenants t
    WHERE f.tenant_id = t.id AND t.slug = 'demo-fleet'
      AND f.kind = 'income' AND f.category IN ('Demo production Etios', 'Demo production Cronos', 'Demo production Onix')
  `)

  console.log('Database seed complete')
} finally {
  await closePool()
}
