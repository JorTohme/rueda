import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { PoolClient } from 'pg'
import { getPool } from './db/pool.js'

export const ACCESS_COOKIE = 'fleet_access'
export const REFRESH_COOKIE = 'fleet_refresh'
export const ACCESS_TTL_SECONDS = 60 * 15
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export type AuthUser = { id: string; email: string }
export type Membership = { tenantId: string; tenantName: string; role: 'owner' | 'operator' | 'driver' }

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${derived}`
}

export function verifyPassword(password: string, encoded: string) {
  const [, salt, expectedHex] = encoded.split('$')
  if (!salt || !expectedHex) return false

  const actual = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {}
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=')
    if (key && value.length) cookies[key] = decodeURIComponent(value.join('='))
  }
  return cookies
}

function accessTokenFrom(request: Request) {
  const authorization = request.headers.authorization
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim()
  return parseCookies(request.headers.cookie)[ACCESS_COOKIE]
}

function refreshTokenFrom(request: Request) {
  const bodyToken = typeof request.body?.refreshToken === 'string' ? request.body.refreshToken.trim() : undefined
  return bodyToken || parseCookies(request.headers.cookie)[REFRESH_COOKIE]
}

function setCookie(name: string, token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function setSessionCookies(response: Response, accessToken: string, refreshToken: string) {
  response.setHeader('Set-Cookie', [
    setCookie(ACCESS_COOKIE, accessToken, ACCESS_TTL_SECONDS),
    setCookie(REFRESH_COOKIE, refreshToken, SESSION_TTL_SECONDS),
  ])
}

export function clearSessionCookie(response: Response) {
  response.setHeader('Set-Cookie', [
    setCookie(ACCESS_COOKIE, '', 0),
    setCookie(REFRESH_COOKIE, '', 0),
  ])
}

export async function createSession(userId: string, response: Response, client?: PoolClient) {
  const accessToken = randomBytes(32).toString('base64url')
  const refreshToken = randomBytes(32).toString('base64url')
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000)
  const refreshExpiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  await (client ?? getPool()).query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, refresh_token_hash, refresh_expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashSessionToken(accessToken), accessExpiresAt, hashSessionToken(refreshToken), refreshExpiresAt],
  )
  setSessionCookies(response, accessToken, refreshToken)
}

async function rotateRefreshToken(refreshToken: string, response: Response): Promise<AuthUser | null> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const session = await client.query<{ id: string; user_id: string }>(`
      SELECT id::text, user_id::text
      FROM sessions
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND refresh_expires_at > now()
      FOR UPDATE
    `, [hashSessionToken(refreshToken)])
    const row = session.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return null
    }

    const nextAccessToken = randomBytes(32).toString('base64url')
    const nextRefreshToken = randomBytes(32).toString('base64url')
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000)
    await client.query(`UPDATE sessions
      SET token_hash = $1, expires_at = $2, refresh_token_hash = $3
      WHERE id = $4`, [hashSessionToken(nextAccessToken), accessExpiresAt, hashSessionToken(nextRefreshToken), row.id])
    const user = await client.query<AuthUser>('SELECT id::text, email FROM users WHERE id = $1', [row.user_id])
    await client.query('COMMIT')
    if (!user.rows[0]) return null
    setSessionCookies(response, nextAccessToken, nextRefreshToken)
    return user.rows[0]
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function refreshSession(request: Request, response: Response) {
  const refreshToken = refreshTokenFrom(request)
  return refreshToken ? rotateRefreshToken(refreshToken, response) : null
}

export async function getSessionUser(request: Request, response?: Response): Promise<AuthUser | null> {
  const accessToken = accessTokenFrom(request)
  if (accessToken) {
    const result = await getPool().query<AuthUser>(`
      SELECT u.id::text, u.email
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
    `, [hashSessionToken(accessToken)])
    if (result.rows[0]) return result.rows[0]
  }

  if (!response) return null
  return refreshSession(request, response)
}

export async function deleteSession(request: Request) {
  const accessToken = accessTokenFrom(request)
  const refreshToken = refreshTokenFrom(request)
  if (!accessToken && !refreshToken) return
  await getPool().query(
    'DELETE FROM sessions WHERE ($1::text IS NOT NULL AND token_hash = $1) OR ($2::text IS NOT NULL AND refresh_token_hash = $2)',
    [accessToken ? hashSessionToken(accessToken) : null, refreshToken ? hashSessionToken(refreshToken) : null],
  )
}

export async function getMemberships(userId: string) {
  const result = await getPool().query<Membership>(`
    SELECT t.slug AS "tenantId", t.name AS "tenantName", m.role
    FROM memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = $1
    ORDER BY t.name
  `, [userId])
  return result.rows
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  try {
    const user = await getSessionUser(request, response)
    if (!user) {
      response.status(401).json({ error: 'Authentication required' })
      return
    }
    response.locals.authUser = user
    next()
  } catch (error) {
    next(error)
  }
}

export async function requireTenantMembership(request: Request, response: Response, next: NextFunction) {
  try {
    const user = response.locals.authUser as AuthUser
    const tenant = await getPool().query<{ id: string }>('SELECT id::text FROM tenants WHERE slug = $1', [request.params.tenantId])
    if (!tenant.rows[0]) {
      response.status(404).json({ error: 'Tenant not found' })
      return
    }

    const membership = await getPool().query<{ role: Membership['role'] }>(
      'SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2',
      [tenant.rows[0].id, user.id],
    )
    if (!membership.rows[0]) {
      response.status(403).json({ error: 'Tenant access denied' })
      return
    }
    response.locals.tenantDbId = tenant.rows[0].id
    response.locals.membershipRole = membership.rows[0].role
    next()
  } catch (error) {
    next(error)
  }
}

export function requiredCredentials(body: unknown) {
  const record = body as { email?: unknown; password?: unknown } | null
  const email = typeof record?.email === 'string' ? normalizeEmail(record.email) : undefined
  const password = typeof record?.password === 'string' ? record.password : undefined
  return email && password ? { email, password } : undefined
}
