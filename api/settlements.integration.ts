import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { closePool, getPool } from './db/pool.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const suffix = Date.now().toString()
const email = `settlements-${suffix}@example.test`
let driverId = ''
const movementIds: string[] = []
let settlementId = ''
let vehicles: Array<{ id: string; brand: string; model: string; licensePlate: string; status: string; applications: string[] }> = []

try {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.DEMO_EMAIL ?? 'demo@rueda.local', password: process.env.DEMO_PASSWORD ?? 'demo-password' }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie)
  const headers = { cookie }
  const vehiclesResponse = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`, { headers })
  vehicles = await vehiclesResponse.json() as Array<{ id: string; brand: string; model: string; licensePlate: string; status: string; applications: string[] }>
  assert.ok(vehicles[0]?.id)
  const vehicleUpdate = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles/${vehicles[0].id}`, {
    method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ brand: vehicles[0].brand, model: vehicles[0].model, licensePlate: vehicles[0].licensePlate, status: vehicles[0].status, applications: ['uber'] }),
  })
  assert.equal(vehicleUpdate.status, 200)

  const driverResponse = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: `Settlement Driver ${suffix}`, email }),
  })
  assert.equal(driverResponse.status, 201)
  driverId = (await driverResponse.json() as { id: string }).id

  const movementHeaders = { ...headers, 'content-type': 'application/json' }
  for (const body of [
    { vehicleId: vehicles[0].id, driverId, kind: 'income', category: `Settlement income ${suffix}`, amount: 1000, occurredOn: '2099-02-01', applicationSlug: 'uber', tripCount: 8, recipient: 'driver' },
    { vehicleId: vehicles[0].id, driverId, kind: 'expense', category: `Settlement expense ${suffix}`, amount: 100, occurredOn: '2099-02-01' },
  ]) {
    const response = await fetch(`${baseUrl}/api/tenants/demo-fleet/financial-movements`, { method: 'POST', headers: movementHeaders, body: JSON.stringify(body) })
    assert.equal(response.status, 201)
    movementIds.push((await response.json() as { id: string }).id)
  }

  const preview = await fetch(`${baseUrl}/api/tenants/demo-fleet/settlements/preview`, {
    method: 'POST', headers: movementHeaders,
    body: JSON.stringify({ driverId, vehicleId: vehicles[0].id, periodStart: '2099-02-01', periodEnd: '2099-02-28', fixedAmount: 200, revenuePercent: 10 }),
  })
  assert.equal(preview.status, 200)
  const previewBody = await preview.json() as { grossIncome: number; driverExpenses: number; ownerAmount: number; driverAmount: number }
  assert.equal(previewBody.grossIncome, 1000)
  assert.equal(previewBody.driverExpenses, 100)
  assert.equal(previewBody.ownerAmount, 300)
  assert.equal(previewBody.driverAmount, 600)

  const created = await fetch(`${baseUrl}/api/tenants/demo-fleet/settlements`, {
    method: 'POST', headers: movementHeaders,
    body: JSON.stringify({ driverId, vehicleId: vehicles[0].id, periodStart: '2099-02-01', periodEnd: '2099-02-28', fixedAmount: 200, revenuePercent: 10 }),
  })
  assert.equal(created.status, 201)
  settlementId = (await created.json() as { id: string; status: string }).id

  const duplicate = await fetch(`${baseUrl}/api/tenants/demo-fleet/settlements`, {
    method: 'POST', headers: movementHeaders,
    body: JSON.stringify({ driverId, vehicleId: vehicles[0].id, periodStart: '2099-02-01', periodEnd: '2099-02-28', fixedAmount: 200, revenuePercent: 10 }),
  })
  assert.equal(duplicate.status, 409)

  const closed = await fetch(`${baseUrl}/api/tenants/demo-fleet/settlements/${settlementId}/close`, { method: 'PATCH', headers: movementHeaders })
  assert.equal(closed.status, 200)
  assert.equal((await closed.json() as { status: string }).status, 'closed')

  const list = await fetch(`${baseUrl}/api/tenants/demo-fleet/settlements`, { headers })
  assert.equal(list.status, 200)
  assert.ok((await list.json() as Array<{ id: string; status: string }>).some((settlement) => settlement.id === settlementId && settlement.status === 'closed'))
  console.log('Settlements database integration check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  const pool = getPool()
  if (vehicles?.[0]) await pool.query('UPDATE vehicles SET brand = $1, model = $2, license_plate = $3, status = $4, application_slugs = $5 WHERE id = $6', [vehicles[0].brand, vehicles[0].model, vehicles[0].licensePlate, vehicles[0].status, vehicles[0].applications, vehicles[0].id])
  if (settlementId) await pool.query('DELETE FROM settlements WHERE id = $1', [settlementId])
  if (movementIds.length) await pool.query('DELETE FROM financial_movements WHERE id = ANY($1::bigint[])', [movementIds])
  if (driverId) await pool.query('DELETE FROM drivers WHERE id = $1', [driverId])
  await closePool()
}
