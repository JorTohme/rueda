import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { closePool, getPool } from './db/pool.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const suffix = Date.now().toString().slice(-8)
const testLicensePlate = `TEST ${suffix}`

try {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.DEMO_EMAIL ?? 'demo@rueda.local', password: process.env.DEMO_PASSWORD ?? 'demo-password' }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie)
  const headers = { cookie }

  const before = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`, { headers })
  assert.equal(before.status, 200)
  const initialVehicles = await before.json() as Array<{ licensePlate: string }>
  assert.ok(initialVehicles.some((vehicle) => vehicle.licensePlate === 'AA 123 BB'))
  assert.ok(!initialVehicles.some((vehicle) => vehicle.licensePlate === 'ZZ 999 ZZ'))

  const invalid = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ brand: 'Ford' }),
  })
  assert.equal(invalid.status, 400)

  const created = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ brand: 'Ford', model: 'Fiesta', licensePlate: testLicensePlate, status: 'maintenance' }),
  })
  assert.equal(created.status, 201)
  assert.deepEqual((await created.json() as { status: string }).status, 'maintenance')

  const after = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`, { headers })
  const vehicles = await after.json() as Array<{ licensePlate: string }>
  assert.ok(vehicles.some((vehicle) => vehicle.licensePlate === testLicensePlate))
  assert.ok(!vehicles.some((vehicle) => vehicle.licensePlate === 'ZZ 999 ZZ'))

  console.log('Vehicle database integration check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await getPool().query('DELETE FROM vehicles WHERE license_plate = $1', [testLicensePlate])
  await closePool()
}
