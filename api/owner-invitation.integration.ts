import assert from 'node:assert/strict'
import { parseOwnerInvitationArgs, createOwnerInvitationToken, hashOwnerInvitationToken } from './owner-invitation.js'

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

console.log('Owner invitation primitive checks passed')
