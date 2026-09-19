import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { hashSessionToken } from './auth.js'
import { closePool, getPool } from './db/pool.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const credentials = {
  email: process.env.DEMO_EMAIL ?? 'demo@rueda.local',
  password: process.env.DEMO_PASSWORD ?? 'demo-password',
}

try {
  const unauthenticated = await fetch(`${baseUrl}/api/tenants/demo-fleet/dashboard-summary`)
  assert.equal(unauthenticated.status, 401)
  const unauthenticatedVehicles = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`)
  assert.equal(unauthenticatedVehicles.status, 401)

  const unknownApi = await fetch(`${baseUrl}/api/does-not-exist`)
  assert.equal(unknownApi.status, 404)
  assert.deepEqual(await unknownApi.json(), { error: 'Not found' })

  const oversized = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: credentials.email, password: 'x'.repeat(120_000) }),
  })
  assert.equal(oversized.status, 413)
  assert.equal(oversized.headers.get('cache-control'), 'no-store')

  const malformed = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  })
  assert.equal(malformed.status, 400)
  assert.equal(malformed.headers.get('cache-control'), 'no-store')

  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: credentials.email, password: 'wrong-password' }),
  })
  assert.equal(invalidLogin.status, 401)

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
  })
  assert.equal(login.status, 200)
  assert.equal(login.headers.get('cache-control'), 'no-store')
  const loginSetCookie = login.headers.get('set-cookie') ?? ''
  assert.match(loginSetCookie, /fleet_access=/)
  assert.match(loginSetCookie, /fleet_refresh=/)
  assert.match(loginSetCookie, /Max-Age=900/)
  assert.match(loginSetCookie, /Max-Age=2592000/)
  let cookie = loginSetCookie.split(',').map((value) => value.split(';', 1)[0]).join('; ')
  assert.ok(cookie)
  const accessToken = decodeURIComponent(cookie.split('; ').find((value) => value.startsWith('fleet_access='))?.split('=', 2)[1] ?? '')
  await getPool().query('UPDATE sessions SET expires_at = now() - interval \'1 minute\' WHERE token_hash = $1', [hashSessionToken(accessToken)])
  const autoRefresh = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } })
  assert.equal(autoRefresh.status, 200)
  assert.equal(autoRefresh.headers.get('cache-control'), 'no-store')
  const autoRefreshSetCookie = autoRefresh.headers.get('set-cookie') ?? ''
  assert.match(autoRefreshSetCookie, /fleet_access=/)
  cookie = autoRefreshSetCookie.split(',').map((value) => value.split(';', 1)[0]).join('; ')
  const headers = { cookie }

  const refresh = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', headers })
  assert.equal(refresh.status, 200)
  assert.equal(refresh.headers.get('cache-control'), 'no-store')
  const refreshedSetCookie = refresh.headers.get('set-cookie') ?? ''
  assert.match(refreshedSetCookie, /fleet_access=/)
  assert.match(refreshedSetCookie, /fleet_refresh=/)
  const refreshedCookie = refreshedSetCookie.split(',').map((value) => value.split(';', 1)[0]).join('; ')
  const reusedRefresh = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', headers })
  assert.equal(reusedRefresh.status, 401)

  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: refreshedCookie } })
  assert.equal(me.status, 200)
  assert.equal(me.headers.get('cache-control'), 'no-store')
  const meBody = await me.json() as { user: { email: string }; memberships: Array<{ tenantId: string; role: string }> }
  assert.equal(meBody.user.email, credentials.email.toLowerCase())
  assert.ok(meBody.memberships.some((membership) => membership.tenantId === 'demo-fleet' && membership.role === 'owner'))

  const summary = await fetch(`${baseUrl}/api/tenants/demo-fleet/dashboard-summary`, { headers: { cookie: refreshedCookie } })
  assert.equal(summary.status, 200)
  const forbidden = await fetch(`${baseUrl}/api/tenants/other-fleet/dashboard-summary`, { headers: { cookie: refreshedCookie } })
  assert.equal(forbidden.status, 403)

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rateAttempt = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: credentials.email, password: 'wrong-password' }),
    })
    assert.equal(rateAttempt.status, 401)
  }
  const rateLimited = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: credentials.email, password: 'wrong-password' }),
  })
  assert.equal(rateLimited.status, 429)
  assert.equal(rateLimited.headers.get('retry-after'), '900')

  const forwardedAttempt = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
    body: JSON.stringify({ email: credentials.email, password: 'wrong-password' }),
  })
  assert.equal(forwardedAttempt.status, 401)

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie: refreshedCookie } })
  assert.equal(logout.status, 200)
  assert.equal(logout.headers.get('cache-control'), 'no-store')
  const afterLogout = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: refreshedCookie } })
  assert.equal(afterLogout.status, 401)

  console.log('Auth integration check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await getPool().query('DELETE FROM sessions WHERE expires_at <= now()')
  await closePool()
}
