import { createHash, randomBytes } from 'node:crypto'
import { normalizeEmail } from './auth.js'

export const OWNER_INVITATION_TTL_SECONDS = 48 * 60 * 60

export type OwnerInvitationArgs = {
  email: string
  organizationName: string
  expiresHours: number
}

export function createOwnerInvitationToken() {
  return randomBytes(32).toString('base64url')
}

export function hashOwnerInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function parseOwnerInvitationArgs(argv: string[]): OwnerInvitationArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('arguments must be provided as --email <value> --organization <value> [--expires-hours <value>]')
    }
    if (!['--email', '--organization', '--expires-hours'].includes(key) || values.has(key)) {
      throw new Error(`unsupported or repeated argument: ${key}`)
    }
    values.set(key, value)
  }

  const email = values.get('--email') ? normalizeEmail(values.get('--email') as string) : ''
  const organizationName = values.get('--organization')?.trim() ?? ''
  if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('email is required and must be valid')
  }
  if (organizationName.length < 2 || organizationName.length > 80) {
    throw new Error('organization must be between 2 and 80 characters')
  }

  const expiresValue = values.get('--expires-hours')
  const expiresHours = expiresValue === undefined ? 48 : Number(expiresValue)
  if (!Number.isInteger(expiresHours) || expiresHours < 1 || expiresHours > 168) {
    throw new Error('expires-hours must be an integer between 1 and 168')
  }

  return { email, organizationName, expiresHours }
}
