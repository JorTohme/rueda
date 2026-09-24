import { closePool, getPool } from './pool.js'
import { normalizeEmail } from '../auth.js'

try {
  const email = normalizeEmail(process.argv[2] ?? '')
  if (!email) throw new Error('usage: tsx api/db/check-owner-invitation.ts <email>')

  const result = await getPool().query(
    `SELECT email, organization_name, status, expires_at, expires_at > now() AS still_valid, now() AS current_time
     FROM owner_invitations WHERE email = $1 ORDER BY id DESC LIMIT 5`,
    [email],
  )
  console.table(result.rows)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to check owner invitation')
  process.exitCode = 1
} finally {
  await closePool()
}
