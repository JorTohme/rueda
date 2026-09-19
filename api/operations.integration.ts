import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { closePool, getPool } from './db/pool.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const suffix = Date.now().toString()
const email = `operations-${suffix}@example.test`
const movementIds: string[] = []
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
  assert.equal(vehiclesResponse.status, 200)
  vehicles = await vehiclesResponse.json() as Array<{ id: string; brand: string; model: string; licensePlate: string; status: string; applications: string[] }>
  assert.ok(vehicles[0]?.id)

  const settingsResponse = await fetch(`${baseUrl}/api/tenants/demo-fleet/settings`, { headers })
  assert.equal(settingsResponse.status, 200)
  const settings = await settingsResponse.json() as { tenantName: string; applications: Array<{ slug: string; name: string; enabled: boolean }> }
  assert.ok(settings.tenantName)
  assert.ok(settings.applications.some((application) => application.slug === 'uber'))

  const settingsUpdate = await fetch(`${baseUrl}/api/tenants/demo-fleet/settings`, {
    method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  })
  assert.equal(settingsUpdate.status, 200)

  const vehicleUpdate = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles/${vehicles[0].id}`, {
    method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ brand: 'Toyota', model: 'Corolla actualizado', licensePlate: 'AA123AA', status: 'active', applications: ['uber', 'cabify'] }),
  })
  assert.equal(vehicleUpdate.status, 200)
  const updatedVehicle = await vehicleUpdate.json() as { model: string; applications: string[] }
  assert.equal(updatedVehicle.model, 'Corolla actualizado')
  assert.deepEqual(updatedVehicle.applications, ['uber', 'cabify'])

  const invalidDriver = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'A' }),
  })
  assert.equal(invalidDriver.status, 400)

  const driverResponse = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'Driver Operations', email, phone: '11-5555-1212' }),
  })
  assert.equal(driverResponse.status, 201)
  const driver = await driverResponse.json() as { id: string; status: string }
  assert.equal(driver.status, 'active')

  const assignmentResponse = await fetch(`${baseUrl}/api/tenants/demo-fleet/assignments`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId: vehicles[0].id, driverId: driver.id }),
  })
  assert.equal(assignmentResponse.status, 201)
  const assignment = await assignmentResponse.json() as { id: string; driverId: string; vehicleId: string }
  assert.equal(assignment.driverId, driver.id)
  assert.equal(assignment.vehicleId, vehicles[0].id)

  const duplicateAssignment = await fetch(`${baseUrl}/api/tenants/demo-fleet/assignments`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId: vehicles[0].id, driverId: driver.id }),
  })
  assert.equal(duplicateAssignment.status, 409)

  const incompleteProduction = await fetch(`${baseUrl}/api/tenants/demo-fleet/financial-movements`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId: vehicles[0].id, driverId: driver.id, kind: 'income', category: 'Incomplete', amount: 10, occurredOn: '2099-01-01' }),
  })
  assert.equal(incompleteProduction.status, 400)

  const movement = await fetch(`${baseUrl}/api/tenants/demo-fleet/financial-movements`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId: vehicles[0].id, driverId: driver.id, kind: 'income', category: `Trips ${suffix}`, amount: '1234.50', occurredOn: '2099-01-01', applicationSlug: 'uber', tripCount: 12, recipient: 'driver' }),
  })
  assert.equal(movement.status, 201)
  const movementBody = await movement.json() as { id: string; amount: number; kind: string; applicationSlug: string; tripCount: number; recipient: string }
  movementIds.push(movementBody.id)
  assert.equal(movementBody.amount, 1234.5)
  assert.equal(movementBody.kind, 'income')
  assert.equal(movementBody.applicationSlug, 'uber')
  assert.equal(movementBody.tripCount, 12)
  assert.equal(movementBody.recipient, 'driver')

  const expense = await fetch(`${baseUrl}/api/tenants/demo-fleet/financial-movements`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId: vehicles[0].id, kind: 'expense', category: `Fuel ${suffix}`, amount: 100.25, occurredOn: '2099-01-01' }),
  })
  assert.equal(expense.status, 201)
  const expenseBody = await expense.json() as { id: string }
  movementIds.push(expenseBody.id)

  const movements = await fetch(`${baseUrl}/api/tenants/demo-fleet/financial-movements?from=2099-01-01&to=2099-01-01`, { headers })
  assert.equal(movements.status, 200)
  const movementList = await movements.json() as { movements: Array<{ applicationSlug: string; tripCount: number; recipient: string }>; totals: { income: number; expenses: number; profit: number } }
  assert.equal(movementList.movements.find((item) => item.applicationSlug === 'uber')?.tripCount, 12)
  assert.equal(movementList.movements.find((item) => item.applicationSlug === 'uber')?.recipient, 'driver')
  assert.equal(movementList.totals.income, 1234.5)
  assert.equal(movementList.totals.expenses, 100.25)
  assert.equal(movementList.totals.profit, 1134.25)

  const denied = await fetch(`${baseUrl}/api/tenants/other-fleet/drivers`, { headers })
  assert.equal(denied.status, 403)

  const closed = await fetch(`${baseUrl}/api/tenants/demo-fleet/assignments/${assignment.id}`, {
    method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ assignedTo: '2099-01-01' }),
  })
  assert.equal(closed.status, 200)

  console.log('Operations database integration check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  const pool = getPool()
  if (vehicles?.[0]) await pool.query('UPDATE vehicles SET brand = $1, model = $2, license_plate = $3, status = $4, application_slugs = $5 WHERE id = $6', [vehicles[0].brand, vehicles[0].model, vehicles[0].licensePlate, vehicles[0].status, vehicles[0].applications, vehicles[0].id])
  if (movementIds.length) await pool.query('DELETE FROM financial_movements WHERE id = ANY($1::bigint[])', [movementIds])
  await pool.query('DELETE FROM vehicle_driver_assignments WHERE driver_id IN (SELECT id FROM drivers WHERE email = $1)', [email])
  await pool.query('DELETE FROM drivers WHERE email = $1', [email])
  await closePool()
}
