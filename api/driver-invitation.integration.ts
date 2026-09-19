import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { closePool, getPool } from './db/pool.js'

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const suffix = Date.now().toString()
const email = `invite-driver-${suffix}@example.test`
const password = 'driver-password'
let driverId = ''
let invitationId = ''
let userId = ''

async function login(emailValue: string, passwordValue: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: emailValue, password: passwordValue }) })
  assert.equal(response.status, 200)
  return response.headers.get('set-cookie')?.split(';', 1)[0]
}

try {
  const ownerCookie = await login(process.env.DEMO_EMAIL ?? 'demo@rueda.local', process.env.DEMO_PASSWORD ?? 'demo-password')
  assert.ok(ownerCookie)
  const createdDriver = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers`, { method: 'POST', headers: { cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ fullName: `Invited Driver ${suffix}`, email }) })
  assert.equal(createdDriver.status, 201)
  driverId = (await createdDriver.json() as { id: string }).id

  const invitation = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers/${driverId}/invitations`, { method: 'POST', headers: { cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
  assert.equal(invitation.status, 201)
  const invitationBody = await invitation.json() as { id: string; inviteToken: string }
  invitationId = invitationBody.id

  const accepted = await fetch(`${baseUrl}/api/driver-invitations/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: invitationBody.inviteToken, password }) })
  assert.equal(accepted.status, 201)
  const acceptedBody = await accepted.json() as { user: { id: string }; memberships: Array<{ role: string }> }
  userId = acceptedBody.user.id
  assert.equal(acceptedBody.memberships[0]?.role, 'driver')

  const driverCookie = accepted.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(driverCookie)
  const portal = await fetch(`${baseUrl}/api/tenants/demo-fleet/driver-portal`, { headers: { cookie: driverCookie } })
  assert.equal(portal.status, 200)
  assert.equal((await portal.json() as { profile: { id: string } }).profile.id, driverId)
  console.log('Driver invitation acceptance check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  const pool = getPool()
  if (invitationId) await pool.query('DELETE FROM driver_invitations WHERE id = $1', [invitationId])
  if (driverId) await pool.query('DELETE FROM drivers WHERE id = $1', [driverId])
  if (userId) {
    await pool.query('DELETE FROM memberships WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId])
    await pool.query('DELETE FROM users WHERE id = $1', [userId])
  }
  await closePool()
}
