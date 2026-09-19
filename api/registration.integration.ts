import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { closePool, getPool } from './db/pool.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const suffix = Date.now().toString()
const email = `owner-${suffix}@example.test`
const organizationName = `Nueva Flota ${suffix}`
const password = 'correct-horse-battery'
let registeredTenantId = ''

try {
  const invalidPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName, email, password: 'short' }),
  })
  assert.equal(invalidPassword.status, 400)

  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName, email: `  ${email.toUpperCase()} `, password }),
  })
  assert.equal(register.status, 201)
  const registerBody = await register.json() as { user: { email: string }; memberships: Array<{ tenantId: string; role: string }> }
  assert.equal(registerBody.user.email, email)
  assert.equal(registerBody.memberships[0]?.role, 'owner')
  registeredTenantId = registerBody.memberships[0]?.tenantId ?? ''
  assert.ok(registeredTenantId)
  const cookie = register.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie)
  const headers = { cookie }

  const duplicateEmail = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName: 'Otra Flota', email, password }),
  })
  assert.equal(duplicateEmail.status, 409)

  const dashboard = await fetch(`${baseUrl}/api/tenants/${registeredTenantId}/dashboard-summary`, { headers })
  assert.equal(dashboard.status, 200)
  const dashboardBody = await dashboard.json() as { tenantId: string; vehicleCount: number }
  assert.equal(dashboardBody.tenantId, registeredTenantId)
  assert.equal(dashboardBody.vehicleCount, 0)

  const vehicles = await fetch(`${baseUrl}/api/tenants/${registeredTenantId}/vehicles`, { headers })
  assert.equal(vehicles.status, 200)
  assert.deepEqual(await vehicles.json(), [])

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  assert.equal(login.status, 200)
  const loginBody = await login.json() as { memberships: Array<{ tenantId: string }> }
  assert.equal(loginBody.memberships[0]?.tenantId, registeredTenantId)

  console.log('Registration integration check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (registeredTenantId) {
    await getPool().query('DELETE FROM tenants WHERE slug = $1', [registeredTenantId])
  }
  await getPool().query('DELETE FROM users WHERE email = $1', [email])
  await closePool()
}
