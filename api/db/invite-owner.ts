import { closePool, getPool } from './pool.js'
import { createOwnerInvitationToken, hashOwnerInvitationToken, parseOwnerInvitationArgs } from '../owner-invitation.js'

try {
  const { email, organizationName, expiresHours } = parseOwnerInvitationArgs(process.argv.slice(2))
  const token = createOwnerInvitationToken()
  const tokenHash = hashOwnerInvitationToken(token)
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000)
  await getPool().query(
    `INSERT INTO owner_invitations (email, organization_name, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [email, organizationName, tokenHash, expiresAt],
  )
  console.log(`Owner invitation created for ${email}; expires ${expiresAt.toISOString()}; token=${token}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to create owner invitation')
  process.exitCode = 1
} finally {
  await closePool()
}
