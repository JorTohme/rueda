import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createOwnerInvitationToken, hashOwnerInvitationToken } from './owner-invitation.js'
import { closePool, getPool } from './db/pool.js'

async function insertInvitation(email: string, organizationName: string, token: string, expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)) {
  await getPool().query(
    `INSERT INTO owner_invitations (email, organization_name, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [email, organizationName, hashOwnerInvitationToken(token), expiresAt],
  )
}

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
let concurrentTenantId = ''
const invitationTokens: string[] = []

try {
  const invalidPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName, email, password: 'short' }),
  })
  assert.equal(invalidPassword.status, 400)

  const withoutInvitation = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName, email, password }),
  })
  assert.equal(withoutInvitation.status, 403)

  const expiredToken = createOwnerInvitationToken()
  invitationTokens.push(expiredToken)
  await insertInvitation(email, organizationName, expiredToken, new Date(Date.now() - 60_000))
  const expired = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName, email, password, inviteToken: expiredToken }),
  })
  assert.equal(expired.status, 403)

  const mismatchToken = createOwnerInvitationToken()
  invitationTokens.push(mismatchToken)
  await insertInvitation(email, organizationName, mismatchToken)
  const mismatch = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.21' },
    body: JSON.stringify({ organizationName, email: `mismatch-${suffix}@example.test`, password, inviteToken: mismatchToken }),
  })
  assert.equal(mismatch.status, 403)

  const cancelledToken = createOwnerInvitationToken()
  invitationTokens.push(cancelledToken)
  await insertInvitation(email, organizationName, cancelledToken)
  await getPool().query("UPDATE owner_invitations SET status = 'cancelled' WHERE token_hash = $1", [hashOwnerInvitationToken(cancelledToken)])
  const cancelled = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.22' },
    body: JSON.stringify({ organizationName, email, password, inviteToken: cancelledToken }),
  })
  assert.equal(cancelled.status, 403)

  const inviteToken = createOwnerInvitationToken()
  invitationTokens.push(inviteToken)
  await insertInvitation(email, organizationName, inviteToken)
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName, email: `  ${email.toUpperCase()} `, password, inviteToken }),
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

  const reusedInvitation = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName, email: `other-${suffix}@example.test`, password, inviteToken }),
  })
  assert.equal(reusedInvitation.status, 403)

  const duplicateToken = createOwnerInvitationToken()
  invitationTokens.push(duplicateToken)
  await insertInvitation(email, 'Otra Flota', duplicateToken)
  const duplicateEmail = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName: 'Otra Flota', email, password, inviteToken: duplicateToken }),
  })
  assert.equal(duplicateEmail.status, 403)
  assert.deepEqual(await duplicateEmail.json(), { error: 'A valid invitation is required' })

  const concurrentEmail = `concurrent-${suffix}@example.test`
  const concurrentOrganization = `Concurrent Flota ${suffix}`
  const concurrentToken = createOwnerInvitationToken()
  invitationTokens.push(concurrentToken)
  await insertInvitation(concurrentEmail, concurrentOrganization, concurrentToken)
  const concurrentBody = { organizationName: concurrentOrganization, email: concurrentEmail, password, inviteToken: concurrentToken }
  const concurrentResponses = await Promise.all([
    fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(concurrentBody) }),
    fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(concurrentBody) }),
  ])
  assert.equal(concurrentResponses.filter((response) => response.status === 201).length, 1)
  assert.equal(concurrentResponses.filter((response) => response.status === 403).length, 1)
  const concurrentWinner = concurrentResponses.find((response) => response.status === 201)
  assert.ok(concurrentWinner)
  const concurrentWinnerBody = await concurrentWinner.json() as { memberships: Array<{ tenantId: string }> }
  concurrentTenantId = concurrentWinnerBody.memberships[0]?.tenantId ?? ''
  assert.ok(concurrentTenantId)

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
  if (concurrentTenantId) {
    await getPool().query('DELETE FROM tenants WHERE slug = $1', [concurrentTenantId])
  }
  await getPool().query('DELETE FROM owner_invitations WHERE token_hash = ANY($1::text[])', [invitationTokens.map(hashOwnerInvitationToken)])
  await getPool().query('DELETE FROM users WHERE email = $1 OR email = $2', [email, `concurrent-${suffix}@example.test`])
  await closePool()
}
