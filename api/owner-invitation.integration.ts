import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { parseOwnerInvitationArgs, createOwnerInvitationToken, hashOwnerInvitationToken } from './owner-invitation.js'
import { closePool, getPool } from './db/pool.js'

const execFile = promisify(execFileCallback)

const parsed = parseOwnerInvitationArgs([
  '--email', ' Owner@Example.com ',
  '--organization', 'Mi Flota',
  '--expires-hours', '48',
])
assert.deepEqual(parsed, { email: 'owner@example.com', organizationName: 'Mi Flota', expiresHours: 48 })
assert.deepEqual(
  parseOwnerInvitationArgs(['--email', 'owner@example.com', '--organization', 'Mi Flota']),
  { email: 'owner@example.com', organizationName: 'Mi Flota', expiresHours: 48 },
)

const token = createOwnerInvitationToken()
assert.ok(token.length >= 40)
assert.notEqual(hashOwnerInvitationToken(token), token)
assert.equal(hashOwnerInvitationToken(token), hashOwnerInvitationToken(token))
assert.throws(
  () => parseOwnerInvitationArgs(['--email', 'owner@example.com']),
  /organization|required/i,
)

const suffix = Date.now().toString()
const email = `owner-${suffix}@example.test`
const organizationName = `Mi Flota ${suffix}`
try {
  const child = await execFile(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', 'api/db/invite-owner.ts',
    '--email', email,
    '--organization', organizationName,
    '--expires-hours', '48',
  ], { cwd: process.cwd(), env: process.env })
  assert.match(child.stdout, new RegExp(email))
  const tokenMatch = child.stdout.match(/token=([A-Za-z0-9_-]+)/)
  assert.ok(tokenMatch?.[1])
  const invitation = await getPool().query<{ email: string; status: string; token_hash: string }>(
    'SELECT email, status, token_hash FROM owner_invitations WHERE email = $1 ORDER BY id DESC LIMIT 1',
    [email],
  )
  assert.equal(invitation.rows[0]?.status, 'pending')
  assert.equal(invitation.rows[0]?.token_hash, hashOwnerInvitationToken(tokenMatch[1]))
  assert.notEqual(invitation.rows[0]?.token_hash, tokenMatch[1])
  console.log('Owner invitation persistence check passed')
} finally {
  await getPool().query('DELETE FROM owner_invitations WHERE email = $1', [email])
  await closePool()
}
