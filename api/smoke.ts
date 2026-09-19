import assert from 'node:assert/strict'
import { createApp } from './app.js'
import type { DashboardSummary } from './app.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()

assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`

try {
  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.DEMO_EMAIL ?? 'demo@rueda.local', password: process.env.DEMO_PASSWORD ?? 'demo-password' }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie)

  const summary = await fetch(`${baseUrl}/api/tenants/demo-fleet/dashboard-summary`, { headers: { cookie } })
  assert.equal(summary.status, 200)
  const body = (await summary.json()) as DashboardSummary
  assert.equal(body.tenantId, 'demo-fleet')
  assert.equal(body.totals.profit, 860000)
  assert.equal(body.vehicleCount, 3)
  assert.equal(body.activeVehicleCount, 3)
  assert.ok(Array.isArray(body.recentMovements))
  assert.ok(Array.isArray(body.pendingSettlements))

  const missingTenant = await fetch(`${baseUrl}/api/tenants/missing/dashboard-summary`, { headers: { cookie } })
  assert.equal(missingTenant.status, 404)

  console.log('API smoke check passed')
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
