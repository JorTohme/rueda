import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { hashPassword } from './auth.js'
import { closePool, getPool } from './db/pool.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const suffix = Date.now().toString()
const driverEmail = `portal-driver-${suffix}@example.test`
const driverPassword = 'driver-password'
let driverId = ''
let userId = ''
let invitationId = ''
let assignmentId = ''
let documentId = ''
let settlementId = ''
let vehicleId = ''

async function login(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie)
  return { cookie }
}

try {
  const owner = await login(process.env.DEMO_EMAIL ?? 'demo@rueda.local', process.env.DEMO_PASSWORD ?? 'demo-password')
  const ownerHeaders = { cookie: owner.cookie }
  const vehicles = await (await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`, { headers: ownerHeaders })).json() as Array<{ id: string }>
  assert.ok(vehicles[0]?.id)
  vehicleId = vehicles[0].id

  const createdDriver = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers`, {
    method: 'POST', headers: { ...ownerHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ fullName: `Portal Driver ${suffix}` }),
  })
  assert.equal(createdDriver.status, 201)
  driverId = (await createdDriver.json() as { id: string }).id

  const invite = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers/${driverId}/invitations`, {
    method: 'POST', headers: { ...ownerHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ email: driverEmail }),
  })
  assert.equal(invite.status, 201)
  const inviteBody = await invite.json() as { id: string; status: string; inviteToken: string }
  invitationId = inviteBody.id
  assert.equal(inviteBody.status, 'pending')
  assert.ok(inviteBody.inviteToken)

  const user = await getPool().query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text`, [driverEmail, hashPassword(driverPassword)])
  userId = user.rows[0].id
  const link = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers/${driverId}/link-user`, {
    method: 'POST', headers: { ...ownerHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ email: driverEmail }),
  })
  assert.equal(link.status, 200)
  assert.equal((await link.json() as { role: string }).role, 'driver')

  const assignment = await fetch(`${baseUrl}/api/tenants/demo-fleet/assignments`, {
    method: 'POST', headers: { ...ownerHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ vehicleId, driverId }),
  })
  assert.equal(assignment.status, 201)
  assignmentId = (await assignment.json() as { id: string }).id

  const document = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers/${driverId}/documents`, {
    method: 'POST', headers: { ...ownerHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ documentType: 'license', expiresOn: '2099-01-01' }),
  })
  assert.equal(document.status, 201)
  documentId = (await document.json() as { id: string }).id

  const tenant = await getPool().query<{ id: string }>('SELECT id::text FROM tenants WHERE slug = $1', ['demo-fleet'])
  const settlement = await getPool().query<{ id: string }>(`INSERT INTO settlements
    (tenant_id, driver_id, vehicle_id, period_start, period_end, gross_income, driver_expenses, fixed_amount, revenue_percent, owner_amount, driver_amount)
    VALUES ($1, $2, $3, '2099-03-01', '2099-03-31', 1000, 100, 200, 10, 300, 600) RETURNING id::text`, [tenant.rows[0].id, driverId, vehicleId])
  settlementId = settlement.rows[0].id

  const driver = await login(driverEmail, driverPassword)
  const portal = await fetch(`${baseUrl}/api/tenants/demo-fleet/driver-portal`, { headers: { cookie: driver.cookie } })
  assert.equal(portal.status, 200)
  const portalBody = await portal.json() as { profile: { id: string }; vehicles: Array<{ id: string }>; documents: Array<{ id: string }>; settlements: Array<{ id: string }> }
  assert.equal(portalBody.profile.id, driverId)
  assert.ok(portalBody.vehicles.some((vehicle) => vehicle.id === vehicleId))
  assert.ok(portalBody.documents.some((document) => document.id === documentId))
  assert.ok(portalBody.settlements.some((item) => item.id === settlementId))

  const dashboard = await fetch(`${baseUrl}/api/tenants/demo-fleet/dashboard-summary`, { headers: { cookie: driver.cookie } })
  assert.equal(dashboard.status, 403)

  const forbidden = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers/${driverId}/invitations`, {
    method: 'POST', headers: { ...{ cookie: driver.cookie }, 'content-type': 'application/json' }, body: JSON.stringify({ email: `other-${suffix}@example.test` }),
  })
  assert.equal(forbidden.status, 403)
  console.log('Driver portal integration check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  const pool = getPool()
  if (settlementId) await pool.query('DELETE FROM settlements WHERE id = $1', [settlementId])
  if (documentId) await pool.query('DELETE FROM documents WHERE id = $1', [documentId])
  if (assignmentId) await pool.query('DELETE FROM vehicle_driver_assignments WHERE id = $1', [assignmentId])
  if (invitationId) await pool.query('DELETE FROM driver_invitations WHERE id = $1', [invitationId])
  if (driverId) await pool.query('DELETE FROM drivers WHERE id = $1', [driverId])
  if (userId) {
    await pool.query('DELETE FROM memberships WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM users WHERE id = $1', [userId])
  }
  await closePool()
}
