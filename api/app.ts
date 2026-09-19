import { randomBytes } from 'node:crypto'
import express from 'express'
import { clearSessionCookie, createSession, deleteSession, getMemberships, getSessionUser, hashPassword, hashSessionToken, normalizeEmail, refreshSession, requireAuth, requireTenantMembership, requiredCredentials, verifyPassword } from './auth.js'
import { getPool } from './db/pool.js'
import { hashOwnerInvitationToken } from './owner-invitation.js'

export type DashboardSummary = {
  tenantId: string
  tenantName: string
  period: string
  currency: 'ARS'
  totals: { income: number; expenses: number; profit: number }
  vehicleCount: number
  activeVehicleCount: number
  driverCount: number
  profitByVehicle: Array<{ vehicleId: string; label: string; profit: number }>
  monthlyTrend: Array<{ month: string; income: number; expenses: number; profit: number }>
  documentsDue: number
  profitChangePercent: number | null
  recentMovements: Array<{ id: string; kind: MovementKind; category: string; amount: number; occurredOn: string; vehicleLabel: string }>
  pendingSettlements: Array<{ id: string; driverName: string; vehicleLabel: string; periodStart: string; periodEnd: string; status: string; ownerAmount: number; driverAmount: number }>
}

type VehicleRow = {
  id: string
  brand: string
  model: string
  license_plate: string
  status: VehicleStatus
  application_slugs: string[]
  created_at: Date
}

type VehicleStatus = 'active' | 'inactive' | 'maintenance'
type ApplicationRow = { id: string; slug: string; name: string; enabled: boolean }

const vehicleStatuses: VehicleStatus[] = ['active', 'inactive', 'maintenance']
type DriverStatus = 'active' | 'inactive'
type MovementKind = 'income' | 'expense'
type MovementRecipient = 'owner' | 'driver'
type DocumentSubject = 'vehicle' | 'driver'
type DocumentStatus = 'vigente' | 'proximo_a_vencer' | 'vencido' | 'faltante'

const documentDefinitions: Record<DocumentSubject, Array<{ type: string; label: string }>> = {
  vehicle: [
    { type: 'registration', label: 'Vehicle registration' },
    { type: 'insurance', label: 'Insurance' },
    { type: 'technical_inspection', label: 'Technical inspection' },
  ],
  driver: [
    { type: 'license', label: 'Driver license' },
    { type: 'identity', label: 'Identity document' },
  ],
}

type DocumentRow = {
  id: string
  vehicle_id: string | null
  driver_id: string | null
  document_type: string
  document_number: string | null
  issued_on: string | null
  expires_on: string
  notes: string | null
  created_at: Date | string
}

function requiredText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function slugify(value: string) {
  const slug = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return slug || 'mi-flota'
}

function registrationInput(body: unknown) {
  const record = body as { organizationName?: unknown; email?: unknown; password?: unknown; inviteToken?: unknown } | null
  const organizationName = requiredText(record?.organizationName)
  const email = typeof record?.email === 'string' ? normalizeEmail(record.email) : undefined
  const password = typeof record?.password === 'string' ? record.password : undefined
  const inviteToken = typeof record?.inviteToken === 'string' ? record.inviteToken.trim() : undefined
  if (!organizationName || organizationName.length < 2 || organizationName.length > 80) return { error: 'organizationName must be between 2 and 80 characters' } as const
  if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return { error: 'a valid email is required' } as const
  if (!password || password.length < 8 || password.length > 128) return { error: 'password must be between 8 and 128 characters' } as const
  return { organizationName, email, password, inviteToken } as const
}

function vehicleResponse(vehicle: VehicleRow) {
  return {
    id: vehicle.id,
    brand: vehicle.brand,
    model: vehicle.model,
    licensePlate: vehicle.license_plate,
    status: vehicle.status,
    applications: vehicle.application_slugs ?? [],
    createdAt: vehicle.created_at.toISOString(),
  }
}

function applicationResponse(application: ApplicationRow) {
  return { id: application.id, slug: application.slug, name: application.name, enabled: application.enabled }
}

function applicationSlugsInput(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const slugs = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().toLowerCase()))]
  return slugs.length === value.length && slugs.length <= 12 && slugs.every((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) ? slugs : undefined
}

function applicationSettingsInput(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) return undefined
  const applications = value.map((item) => {
    const record = item as { slug?: unknown; name?: unknown; enabled?: unknown } | null
    const slug = typeof record?.slug === 'string' ? record.slug.trim().toLowerCase() : undefined
    const name = requiredText(record?.name)
    const enabled = record?.enabled === undefined ? true : record.enabled
    return slug && name && typeof enabled === 'boolean' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && name.length <= 80
      ? { slug, name, enabled }
      : undefined
  })
  return applications.every(Boolean) ? applications as Array<{ slug: string; name: string; enabled: boolean }> : undefined
}

function parsePositiveInteger(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value)
  return /^\d+$/.test(text) && Number(text) > 0 ? text : undefined
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? undefined : value
}

function parseAmount(value: unknown) {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d+(\.\d{1,2})?$/.test(text)) return undefined
  const amount = Number(text)
  return Number.isFinite(amount) && amount > 0 && amount <= 999999999999.99 ? text : undefined
}

function parseTripCount(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return undefined
  const count = Number(text)
  return Number.isSafeInteger(count) && count >= 0 && count <= 100000 ? count : undefined
}

function documentStatus(expiresOn: string, today = new Date()): DocumentStatus {
  const expiration = new Date(`${expiresOn}T00:00:00Z`)
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const daysUntilExpiration = Math.ceil((expiration.getTime() - current.getTime()) / 86400000)
  if (daysUntilExpiration < 0) return 'vencido'
  if (daysUntilExpiration <= 30) return 'proximo_a_vencer'
  return 'vigente'
}

function documentResponse(document: DocumentRow, subject: DocumentSubject) {
  const definition = documentDefinitions[subject].find((item) => item.type === document.document_type)
  return {
    id: document.id,
    subject,
    vehicleId: document.vehicle_id,
    driverId: document.driver_id,
    documentType: document.document_type,
    label: definition?.label ?? document.document_type,
    documentNumber: document.document_number,
    issuedOn: document.issued_on,
    expiresOn: document.expires_on,
    notes: document.notes,
    status: documentStatus(document.expires_on),
    createdAt: new Date(document.created_at).toISOString(),
  }
}

function parseNonNegativeAmount(value: unknown) {
  const text = value === undefined || value === null || value === '' ? '0' : typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d+(\.\d{1,2})?$/.test(text)) return undefined
  const amount = Number(text)
  return Number.isFinite(amount) && amount >= 0 && amount <= 999999999999.99 ? text : undefined
}

function parseRate(value: unknown) {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d+(\.\d{1,2})?$/.test(text)) return undefined
  const rate = Number(text)
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? text : undefined
}

function driverInput(body: unknown) {
  const record = body as { fullName?: unknown; email?: unknown; phone?: unknown; status?: unknown } | null
  const fullName = requiredText(record?.fullName)
  const email = record?.email === undefined || record.email === null || record.email === ''
    ? null
    : typeof record.email === 'string' ? normalizeEmail(record.email) : undefined
  const phone = record?.phone === undefined || record.phone === null || record.phone === ''
    ? null
    : requiredText(record.phone)
  const status = (record?.status ?? 'active') as DriverStatus
  if (!fullName || fullName.length < 2 || fullName.length > 120) return { error: 'fullName must be between 2 and 120 characters' } as const
  if (email !== null && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: 'email must be valid' } as const
  if (phone !== null && (!phone || phone.length > 40)) return { error: 'phone must be at most 40 characters' } as const
  if (!['active', 'inactive'].includes(status)) return { error: 'status must be active or inactive' } as const
  return { fullName, email, phone, status } as const
}

function driverResponse(driver: { id: string; full_name: string; email: string | null; phone: string | null; status: DriverStatus; created_at: Date | string }) {
  return { id: driver.id, fullName: driver.full_name, email: driver.email, phone: driver.phone, status: driver.status, createdAt: new Date(driver.created_at).toISOString() }
}

function documentInput(body: unknown) {
  const record = body as {
    vehicleId?: unknown; driverId?: unknown; documentType?: unknown; documentNumber?: unknown
    issuedOn?: unknown; expiresOn?: unknown; notes?: unknown
  } | null
  const vehicleId = record?.vehicleId === undefined || record.vehicleId === null || record.vehicleId === '' ? null : parsePositiveInteger(record.vehicleId)
  const driverId = record?.driverId === undefined || record.driverId === null || record.driverId === '' ? null : parsePositiveInteger(record.driverId)
  const documentType = requiredText(record?.documentType)
  const documentNumber = record?.documentNumber === undefined || record.documentNumber === null || record.documentNumber === '' ? null : requiredText(record.documentNumber)
  const issuedOn = record?.issuedOn === undefined || record.issuedOn === null || record.issuedOn === '' ? null : parseDate(record.issuedOn)
  const expiresOn = parseDate(record?.expiresOn)
  const notes = record?.notes === undefined || record.notes === null || record.notes === '' ? null : requiredText(record.notes)
  if ((vehicleId === null) === (driverId === null)) return { error: 'exactly one of vehicleId or driverId is required' } as const
  if (!documentType || documentType.length < 2 || documentType.length > 80) return { error: 'documentType must be between 2 and 80 characters' } as const
  if ((record?.documentNumber !== undefined && documentNumber === undefined) || (documentNumber && documentNumber.length > 120)) return { error: 'documentNumber must be at most 120 characters' } as const
  if (record?.issuedOn !== undefined && record.issuedOn !== null && record.issuedOn !== '' && !issuedOn) return { error: 'issuedOn must be a valid date' } as const
  if (!expiresOn) return { error: 'expiresOn must be a valid date' } as const
  if (record?.notes !== undefined && record.notes !== null && record.notes !== '' && !notes) return { error: 'notes must not be empty' } as const
  return { vehicleId, driverId, documentType, documentNumber, issuedOn, expiresOn, notes } as const
}

function movementResponse(movement: { id: string; vehicle_id: string; driver_id: string | null; kind: MovementKind; category: string; amount: string | number; occurred_on: string; notes: string | null; application_slug: string | null; trip_count: number | null; recipient: MovementRecipient | null; created_at: Date | string }) {
  return { id: movement.id, vehicleId: movement.vehicle_id, driverId: movement.driver_id, kind: movement.kind, category: movement.category, amount: Number(movement.amount), occurredOn: movement.occurred_on, notes: movement.notes, applicationSlug: movement.application_slug, tripCount: movement.trip_count, recipient: movement.recipient, createdAt: new Date(movement.created_at).toISOString() }
}

function settlementInput(body: unknown) {
  const record = body as { driverId?: unknown; vehicleId?: unknown; periodStart?: unknown; periodEnd?: unknown; fixedAmount?: unknown; revenuePercent?: unknown } | null
  const driverId = parsePositiveInteger(record?.driverId)
  const vehicleId = parsePositiveInteger(record?.vehicleId)
  const periodStart = parseDate(record?.periodStart)
  const periodEnd = parseDate(record?.periodEnd)
  const fixedAmount = parseNonNegativeAmount(record?.fixedAmount)
  const revenuePercent = parseRate(record?.revenuePercent)
  if (!driverId || !vehicleId || !periodStart || !periodEnd || periodEnd < periodStart || fixedAmount === undefined || revenuePercent === undefined) {
    return { error: 'driverId, vehicleId, periodStart, periodEnd and valid rule values are required' } as const
  }
  return { driverId, vehicleId, periodStart, periodEnd, fixedAmount, revenuePercent } as const
}

export function createApp() {
  const app = express()
  app.use(express.json())

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.post('/api/auth/login', async (request, response, next) => {
    const credentials = requiredCredentials(request.body)
    if (!credentials) {
      response.status(400).json({ error: 'email and password are required' })
      return
    }

    try {
      const result = await getPool().query<{ id: string; email: string; password_hash: string }>(
        'SELECT id::text, email, password_hash FROM users WHERE email = $1',
        [credentials.email],
      )
      const user = result.rows[0]
      if (!user || !verifyPassword(credentials.password, user.password_hash)) {
        response.status(401).json({ error: 'Invalid email or password' })
        return
      }

      await createSession(user.id, response)
      response.json({ user: { id: user.id, email: user.email }, memberships: await getMemberships(user.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/register', async (request, response, next) => {
    const input = registrationInput(request.body)
    if ('error' in input) {
      response.status(400).json({ error: input.error })
      return
    }

    if (!input.inviteToken || input.inviteToken.length < 20 || input.inviteToken.length > 128) {
      response.status(403).json({ error: 'A valid invitation is required' })
      return
    }

    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const invitation = await client.query<{ id: string; organization_name: string }>(
        `SELECT id::text, organization_name
         FROM owner_invitations
         WHERE token_hash = $1 AND email = $2 AND status = 'pending' AND expires_at > now()
         FOR UPDATE`,
        [hashOwnerInvitationToken(input.inviteToken), input.email],
      )
      const invitationRow = invitation.rows[0]
      if (!invitationRow || invitationRow.organization_name !== input.organizationName) {
        await client.query('ROLLBACK')
        response.status(403).json({ error: 'A valid invitation is required' })
        return
      }

      const existingUser = await client.query('SELECT 1 FROM users WHERE email = $1', [input.email])
      if (existingUser.rowCount) {
        await client.query('ROLLBACK')
        response.status(409).json({ error: 'An account with this email already exists' })
        return
      }

      const baseSlug = slugify(invitationRow.organization_name)
      let tenant: { id: string; slug: string; name: string } | undefined
      for (let attempt = 0; attempt < 5 && !tenant; attempt += 1) {
        const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomBytes(3).toString('hex')}`
        await client.query('SAVEPOINT tenant_slug_attempt')
        try {
          const result = await client.query<{ id: string; slug: string; name: string }>(
            'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id::text, slug, name',
            [slug, invitationRow.organization_name],
          )
          tenant = result.rows[0]
        } catch (error) {
          if (!isUniqueViolation(error)) throw error
          await client.query('ROLLBACK TO SAVEPOINT tenant_slug_attempt')
        } finally {
          await client.query('RELEASE SAVEPOINT tenant_slug_attempt')
        }
      }
      if (!tenant) throw new Error('Unable to allocate tenant slug')
      await client.query(`INSERT INTO tenant_applications (tenant_id, slug, name)
        VALUES ($1, 'uber', 'Uber'), ($1, 'cabify', 'Cabify'), ($1, 'maxim', 'Maxim'), ($1, 'didi', 'DiDi')
        ON CONFLICT (tenant_id, slug) DO NOTHING`, [tenant.id])

      const userResult = await client.query<{ id: string; email: string }>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text, email',
        [input.email, hashPassword(input.password)],
      )
      const user = userResult.rows[0]
      await client.query('INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)', [user.id, tenant.id, 'owner'])
      await client.query("UPDATE owner_invitations SET status = 'accepted', accepted_at = now() WHERE id = $1 AND status = 'pending'", [invitationRow.id])
      await createSession(user.id, response, client)
      await client.query('COMMIT')
      response.status(201).json({ user, memberships: [{ tenantId: tenant.slug, tenantName: tenant.name, role: 'owner' }] })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      clearSessionCookie(response)
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'An account with this email already exists' })
        return
      }
      next(error)
    } finally {
      client.release()
    }
  })

  app.post('/api/driver-invitations/accept', async (request, response, next) => {
    const token = typeof request.body?.token === 'string' ? request.body.token.trim() : undefined
    const password = typeof request.body?.password === 'string' ? request.body.password : undefined
    if (!token || token.length < 20 || token.length > 128 || !password || password.length < 8 || password.length > 128) {
      response.status(400).json({ error: 'token and password are required; password must be between 8 and 128 characters' })
      return
    }

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      const invitation = await client.query<{ id: string; tenant_id: string; tenant_slug: string; tenant_name: string; driver_id: string; email: string; driver_user_id: string | null }>(`SELECT i.id::text, i.tenant_id::text, t.slug AS tenant_slug, t.name AS tenant_name, i.driver_id::text, i.email, d.user_id::text AS driver_user_id
        FROM driver_invitations i
        JOIN tenants t ON t.id = i.tenant_id
        JOIN drivers d ON d.id = i.driver_id AND d.tenant_id = i.tenant_id
        WHERE i.token_hash = $1 AND i.status = 'pending' AND i.expires_at > now()
        FOR UPDATE OF i, d`, [hashSessionToken(token)])
      const row = invitation.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        response.status(400).json({ error: 'Invitation is invalid or expired' })
        return
      }
      if (row.driver_user_id) {
        await client.query('ROLLBACK')
        response.status(409).json({ error: 'This driver already has a linked account' })
        return
      }
      const existingUser = await client.query('SELECT 1 FROM users WHERE email = $1', [row.email])
      if (existingUser.rowCount) {
        await client.query('ROLLBACK')
        response.status(409).json({ error: 'An account with this email already exists; ask the owner to link it' })
        return
      }
      const userResult = await client.query<{ id: string; email: string }>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id::text, email',
        [row.email, hashPassword(password)],
      )
      const user = userResult.rows[0]
      await client.query('INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)', [user.id, row.tenant_id, 'driver'])
      await client.query('UPDATE drivers SET user_id = $1 WHERE id = $2 AND user_id IS NULL', [user.id, row.driver_id])
      await client.query("UPDATE driver_invitations SET status = 'accepted' WHERE id = $1", [row.id])
      await createSession(user.id, response, client)
      await client.query('COMMIT')
      response.status(201).json({ user, memberships: [{ tenantId: row.tenant_slug, tenantName: row.tenant_name, role: 'driver' }] })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      clearSessionCookie(response)
      next(error)
    } finally {
      client.release()
    }
  })

  app.get('/api/auth/me', async (request, response, next) => {
    try {
      const user = await getSessionUser(request, response)
      if (!user) {
        response.status(401).json({ error: 'Authentication required' })
        return
      }
      response.json({ user, memberships: await getMemberships(user.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/refresh', async (request, response, next) => {
    try {
      const user = await refreshSession(request, response)
      if (!user) {
        clearSessionCookie(response)
        response.status(401).json({ error: 'Refresh token is invalid or expired' })
        return
      }
      response.json({ user, memberships: await getMemberships(user.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/logout', async (request, response, next) => {
    try {
      await deleteSession(request)
      clearSessionCookie(response)
      response.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/tenants/:tenantId/dashboard-summary', requireAuth, requireTenantMembership, async (request, response, next) => {
    if (response.locals.membershipRole === 'driver') {
      response.status(403).json({ error: 'Fleet dashboard is not available for driver accounts' })
      return
    }
    try {
      const tenantSlug = Array.isArray(request.params.tenantId) ? request.params.tenantId[0] : request.params.tenantId
      const period = new Date().toISOString().slice(0, 7)
      const tenant = await getPool().query<{ name: string; vehicle_count: string; active_vehicle_count: string; driver_count: string; id: string }>(
        `SELECT t.id::text, t.name, COUNT(v.id)::text AS vehicle_count,
          COUNT(v.id) FILTER (WHERE v.status = 'active')::text AS active_vehicle_count,
          (SELECT COUNT(*)::text FROM drivers d WHERE d.tenant_id = t.id AND d.status = 'active') AS driver_count
        FROM tenants t LEFT JOIN vehicles v ON v.tenant_id = t.id WHERE t.slug = $1 GROUP BY t.id`,
        [tenantSlug],
      )
      if (!tenant.rows[0]) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }
      const tenantId = tenant.rows[0].id
      const [totals, byVehicle, trend, documentsDue, recentMovements, pendingSettlements, previousTotals] = await Promise.all([
        getPool().query<{ income: string; expenses: string }>(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::text AS income, COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::text AS expenses FROM financial_movements WHERE tenant_id = $1 AND to_char(occurred_on, 'YYYY-MM') = $2`, [tenantId, period]),
        getPool().query<{ vehicle_id: string; label: string; income: string; expenses: string }>(`SELECT v.id::text AS vehicle_id, concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS label, COALESCE(SUM(f.amount) FILTER (WHERE f.kind = 'income'), 0)::text AS income, COALESCE(SUM(f.amount) FILTER (WHERE f.kind = 'expense'), 0)::text AS expenses FROM vehicles v LEFT JOIN financial_movements f ON f.vehicle_id = v.id AND f.tenant_id = $1 AND to_char(f.occurred_on, 'YYYY-MM') = $2 WHERE v.tenant_id = $1 GROUP BY v.id ORDER BY v.created_at`, [tenantId, period]),
        getPool().query<{ month: string; income: string; expenses: string }>(`SELECT to_char(occurred_on, 'YYYY-MM') AS month, COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::text AS income, COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::text AS expenses FROM financial_movements WHERE tenant_id = $1 AND occurred_on >= date_trunc('month', CURRENT_DATE) - interval '5 months' GROUP BY 1 ORDER BY 1`, [tenantId]),
        getPool().query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM documents WHERE tenant_id = $1 AND expires_on <= CURRENT_DATE + 30`, [tenantId]),
        getPool().query<{ id: string; kind: MovementKind; category: string; amount: string; occurred_on: string; vehicle_label: string }>(`SELECT f.id::text, f.kind, f.category, f.amount::text, f.occurred_on::text, concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS vehicle_label
          FROM financial_movements f JOIN vehicles v ON v.id = f.vehicle_id
          WHERE f.tenant_id = $1 ORDER BY f.occurred_on DESC, f.created_at DESC LIMIT 5`, [tenantId]),
        getPool().query<{ id: string; driver_name: string; vehicle_label: string; period_start: string; period_end: string; status: string; owner_amount: string; driver_amount: string }>(`SELECT s.id::text, d.full_name AS driver_name, concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS vehicle_label,
          s.period_start::text, s.period_end::text, s.status, s.owner_amount::text, s.driver_amount::text
          FROM settlements s JOIN drivers d ON d.id = s.driver_id JOIN vehicles v ON v.id = s.vehicle_id
          WHERE s.tenant_id = $1 AND s.status IN ('draft', 'closed') ORDER BY s.period_end DESC, s.created_at DESC LIMIT 5`, [tenantId]),
        getPool().query<{ income: string; expenses: string }>(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::text AS income, COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::text AS expenses
          FROM financial_movements WHERE tenant_id = $1 AND to_char(occurred_on, 'YYYY-MM') = to_char(date_trunc('month', CURRENT_DATE) - interval '1 month', 'YYYY-MM')`, [tenantId]),
      ])
      const income = Number(totals.rows[0]?.income ?? 0)
      const expenses = Number(totals.rows[0]?.expenses ?? 0)
      const previousProfit = Number(previousTotals.rows[0]?.income ?? 0) - Number(previousTotals.rows[0]?.expenses ?? 0)
      const profit = income - expenses
      response.json({
        tenantId: tenantSlug, tenantName: tenant.rows[0].name, period, currency: 'ARS',
        totals: { income, expenses, profit }, vehicleCount: Number(tenant.rows[0].vehicle_count), activeVehicleCount: Number(tenant.rows[0].active_vehicle_count), driverCount: Number(tenant.rows[0].driver_count),
        profitByVehicle: byVehicle.rows.map((row) => ({ vehicleId: row.vehicle_id, label: row.label, profit: Number(row.income) - Number(row.expenses) })),
        monthlyTrend: trend.rows.map((row) => ({ month: row.month, income: Number(row.income), expenses: Number(row.expenses), profit: Number(row.income) - Number(row.expenses) })),
        documentsDue: Number(documentsDue.rows[0]?.count ?? 0), profitChangePercent: previousProfit === 0 ? null : Number((((profit - previousProfit) / Math.abs(previousProfit)) * 100).toFixed(1)),
        recentMovements: recentMovements.rows.map((row) => ({ id: row.id, kind: row.kind, category: row.category, amount: Number(row.amount), occurredOn: row.occurred_on, vehicleLabel: row.vehicle_label })),
        pendingSettlements: pendingSettlements.rows.map((row) => ({ id: row.id, driverName: row.driver_name, vehicleLabel: row.vehicle_label, periodStart: row.period_start, periodEnd: row.period_end, status: row.status, ownerAmount: Number(row.owner_amount), driverAmount: Number(row.driver_amount) })),
      } satisfies DashboardSummary)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/tenants/:tenantId/settings', requireAuth, requireTenantMembership, requireFleetManager, async (_request, response, next) => {
    try {
      const result = await getPool().query<{ tenant_name: string; id: string; slug: string; name: string; enabled: boolean }>(`
        SELECT t.name AS tenant_name, a.id::text, a.slug, a.name, a.enabled
        FROM tenants t LEFT JOIN tenant_applications a ON a.tenant_id = t.id
        WHERE t.id = $1 ORDER BY a.created_at ASC
      `, [response.locals.tenantDbId])
      const first = result.rows[0]
      if (!first) {
        response.status(404).json({ error: 'Tenant not found' })
        return
      }
      response.json({
        tenantName: first.tenant_name,
        applications: result.rows.filter((row) => row.id).map((row) => applicationResponse({ id: row.id, slug: row.slug, name: row.name, enabled: row.enabled })),
      })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/tenants/:tenantId/settings', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const tenantName = request.body?.tenantName === undefined ? undefined : requiredText(request.body?.tenantName)
    const applications = request.body?.applications === undefined ? undefined : applicationSettingsInput(request.body?.applications)
    if (request.body?.tenantName !== undefined && (!tenantName || tenantName.length > 120) || (request.body?.applications !== undefined && !applications)) {
      response.status(400).json({ error: 'tenantName and applications must be valid' })
      return
    }
    const pool = getPool()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (tenantName !== undefined) await client.query('UPDATE tenants SET name = $1 WHERE id = $2', [tenantName, response.locals.tenantDbId])
      for (const application of applications ?? []) {
        await client.query(`INSERT INTO tenant_applications (tenant_id, slug, name, enabled)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name, enabled = EXCLUDED.enabled`,
        [response.locals.tenantDbId, application.slug, application.name, application.enabled])
      }
      await client.query('COMMIT')
      const result = await pool.query<{ tenant_name: string; id: string; slug: string; name: string; enabled: boolean }>(`
        SELECT t.name AS tenant_name, a.id::text, a.slug, a.name, a.enabled
        FROM tenants t LEFT JOIN tenant_applications a ON a.tenant_id = t.id
        WHERE t.id = $1 ORDER BY a.created_at ASC`, [response.locals.tenantDbId])
      const first = result.rows[0]
      response.json({ tenantName: first.tenant_name, applications: result.rows.filter((row) => row.id).map((row) => applicationResponse({ id: row.id, slug: row.slug, name: row.name, enabled: row.enabled })) })
    } catch (error) {
      await client.query('ROLLBACK')
      next(error)
    } finally {
      client.release()
    }
  })

  app.get('/api/tenants/:tenantId/vehicles', requireAuth, requireTenantMembership, async (_request, response, next) => {
    try {
      const pool = getPool()

      const result = await pool.query<VehicleRow>(`
        SELECT v.id, v.brand, v.model, v.license_plate, v.status, v.application_slugs, v.created_at
        FROM vehicles v
        WHERE v.tenant_id = $1
          AND ($2::text <> 'driver' OR EXISTS (
            SELECT 1 FROM vehicle_driver_assignments a
            JOIN drivers d ON d.id = a.driver_id
            WHERE a.vehicle_id = v.id AND a.assigned_to IS NULL AND d.user_id = $3::bigint
          ))
        ORDER BY v.created_at ASC
      `, [response.locals.tenantDbId, response.locals.membershipRole, response.locals.authUser.id])
      response.json(result.rows.map(vehicleResponse))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/vehicles', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const brand = requiredText(request.body?.brand)
    const model = requiredText(request.body?.model)
    const licensePlate = requiredText(request.body?.licensePlate)
    const status = request.body?.status ?? 'active'
    const applications = request.body?.applications === undefined ? [] : applicationSlugsInput(request.body?.applications)

    if (!brand || !model || !licensePlate || !vehicleStatuses.includes(status) || !applications) {
      response.status(400).json({ error: 'brand, model, licensePlate, applications and a valid status are required' })
      return
    }

    try {
      const pool = getPool()
      const validApplications = await pool.query<{ slug: string }>(
        'SELECT slug FROM tenant_applications WHERE tenant_id = $1 AND enabled = TRUE AND slug = ANY($2::text[])',
        [response.locals.tenantDbId, applications],
      )
      if (validApplications.rows.length !== applications.length) {
        response.status(400).json({ error: 'applications must be enabled for this tenant' })
        return
      }
      const result = await pool.query<VehicleRow>(`
        INSERT INTO vehicles (tenant_id, brand, model, license_plate, status, application_slugs)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, brand, model, license_plate, status, application_slugs, created_at
      `, [response.locals.tenantDbId, brand, model, licensePlate, status, applications])

      const vehicle = result.rows[0]
      response.status(201).json(vehicleResponse(vehicle))
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'A vehicle with this licensePlate already exists for this tenant' })
        return
      }
      next(error)
    }
  })

  app.patch('/api/tenants/:tenantId/vehicles/:vehicleId', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const vehicleId = parsePositiveInteger(request.params.vehicleId)
    const brand = requiredText(request.body?.brand)
    const model = requiredText(request.body?.model)
    const licensePlate = requiredText(request.body?.licensePlate)
    const status = request.body?.status ?? 'active'
    const applications = request.body?.applications === undefined ? [] : applicationSlugsInput(request.body?.applications)
    if (!vehicleId || !brand || !model || !licensePlate || !vehicleStatuses.includes(status) || !applications) {
      response.status(400).json({ error: 'vehicleId, brand, model, licensePlate, applications and a valid status are required' })
      return
    }
    try {
      const pool = getPool()
      const validApplications = await pool.query<{ slug: string }>(
        'SELECT slug FROM tenant_applications WHERE tenant_id = $1 AND enabled = TRUE AND slug = ANY($2::text[])',
        [response.locals.tenantDbId, applications],
      )
      if (validApplications.rows.length !== applications.length) {
        response.status(400).json({ error: 'applications must be enabled for this tenant' })
        return
      }
      const result = await pool.query<VehicleRow>(`
        UPDATE vehicles
        SET brand = $1, model = $2, license_plate = $3, status = $4, application_slugs = $5
        WHERE id = $6 AND tenant_id = $7
        RETURNING id, brand, model, license_plate, status, application_slugs, created_at
      `, [brand, model, licensePlate, status, applications, vehicleId, response.locals.tenantDbId])
      if (!result.rows[0]) {
        response.status(404).json({ error: 'Vehicle not found' })
        return
      }
      response.json(vehicleResponse(result.rows[0]))
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'A vehicle with this licensePlate already exists for this tenant' })
        return
      }
      next(error)
    }
  })

  app.get('/api/tenants/:tenantId/drivers', requireAuth, requireTenantMembership, async (_request, response, next) => {
    try {
      const result = await getPool().query<{
        id: string; full_name: string; email: string | null; phone: string | null; status: DriverStatus; created_at: Date
      }>(`SELECT id::text, full_name, email, phone, status, created_at
          FROM drivers WHERE tenant_id = $1 AND ($2::text <> 'driver' OR user_id = $3::bigint) ORDER BY created_at ASC`, [response.locals.tenantDbId, response.locals.membershipRole, response.locals.authUser.id])
      response.json(result.rows.map(driverResponse))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/drivers', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const input = driverInput(request.body)
    if ('error' in input) {
      response.status(400).json({ error: input.error })
      return
    }
    try {
      const result = await getPool().query<{
        id: string; full_name: string; email: string | null; phone: string | null; status: DriverStatus; created_at: Date
      }>(`INSERT INTO drivers (tenant_id, full_name, email, phone, status)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id::text, full_name, email, phone, status, created_at`,
      [response.locals.tenantDbId, input.fullName, input.email, input.phone, input.status])
      response.status(201).json(driverResponse(result.rows[0]))
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/tenants/:tenantId/drivers/:driverId', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const driverId = parsePositiveInteger(request.params.driverId)
    const input = driverInput(request.body)
    if (!driverId || 'error' in input) {
      response.status(400).json({ error: !driverId ? 'driverId must be a positive integer' : input.error })
      return
    }
    try {
      const result = await getPool().query<{
        id: string; full_name: string; email: string | null; phone: string | null; status: DriverStatus; created_at: Date
      }>(`UPDATE drivers SET full_name = $1, email = $2, phone = $3, status = $4
          WHERE id = $5 AND tenant_id = $6
          RETURNING id::text, full_name, email, phone, status, created_at`,
      [input.fullName, input.email, input.phone, input.status, driverId, response.locals.tenantDbId])
      if (!result.rows[0]) {
        response.status(404).json({ error: 'Driver not found' })
        return
      }
      response.json(driverResponse(result.rows[0]))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/drivers/:driverId/link-user', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const driverId = parsePositiveInteger(request.params.driverId)
    const email = typeof request.body?.email === 'string' ? normalizeEmail(request.body.email) : undefined
    if (!driverId || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      response.status(400).json({ error: 'driverId and a valid email are required' })
      return
    }

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      const driver = await client.query<{ id: string; user_id: string | null }>(
        'SELECT id::text, user_id::text FROM drivers WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [driverId, response.locals.tenantDbId],
      )
      if (!driver.rows[0]) {
        await client.query('ROLLBACK')
        response.status(404).json({ error: 'Driver not found' })
        return
      }
      const user = await client.query<{ id: string; email: string }>('SELECT id::text, email FROM users WHERE email = $1', [email])
      if (!user.rows[0]) {
        await client.query('ROLLBACK')
        response.status(404).json({ error: 'User account not found; create an invitation first' })
        return
      }
      const linked = await client.query<{ id: string }>(
        'SELECT id::text FROM drivers WHERE tenant_id = $1 AND user_id = $2 AND id <> $3',
        [response.locals.tenantDbId, user.rows[0].id, driverId],
      )
      if (linked.rows[0]) {
        await client.query('ROLLBACK')
        response.status(409).json({ error: 'User account is already linked to another driver' })
        return
      }
      const membership = await client.query<{ role: 'owner' | 'operator' | 'driver' }>(
        'SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2',
        [response.locals.tenantDbId, user.rows[0].id],
      )
      if (membership.rows[0] && membership.rows[0].role !== 'driver') {
        await client.query('ROLLBACK')
        response.status(409).json({ error: 'User account already has a fleet manager role in this tenant' })
        return
      }
      await client.query('UPDATE drivers SET user_id = $1, email = $2 WHERE id = $3 AND tenant_id = $4', [user.rows[0].id, user.rows[0].email, driverId, response.locals.tenantDbId])
      await client.query(`INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'driver') ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'driver'`, [user.rows[0].id, response.locals.tenantDbId])
      await client.query('COMMIT')
      response.json({ driverId: String(driverId), userId: user.rows[0].id, email: user.rows[0].email, role: 'driver' })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      next(error)
    } finally {
      client.release()
    }
  })

  app.post('/api/tenants/:tenantId/drivers/:driverId/invitations', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const driverId = parsePositiveInteger(request.params.driverId)
    const email = typeof request.body?.email === 'string' ? normalizeEmail(request.body.email) : undefined
    if (!driverId || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      response.status(400).json({ error: 'driverId and a valid email are required' })
      return
    }
    const token = randomBytes(24).toString('base64url')
    try {
      const driver = await getPool().query('SELECT id FROM drivers WHERE id = $1 AND tenant_id = $2', [driverId, response.locals.tenantDbId])
      if (!driver.rows[0]) {
        response.status(404).json({ error: 'Driver not found' })
        return
      }
      const result = await getPool().query<{ id: string; expires_at: Date }>(`INSERT INTO driver_invitations (tenant_id, driver_id, email, token_hash, expires_at)
        VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING id::text, expires_at`, [response.locals.tenantDbId, driverId, email, hashSessionToken(token)])
      response.status(201).json({ id: result.rows[0].id, driverId: String(driverId), email, status: 'pending', expiresAt: result.rows[0].expires_at.toISOString(), inviteToken: token })
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'A pending invitation already exists for this driver and email' })
        return
      }
      next(error)
    }
  })

  app.get('/api/tenants/:tenantId/driver-portal', requireAuth, requireTenantMembership, async (_request, response, next) => {
    if (response.locals.membershipRole !== 'driver') {
      response.status(403).json({ error: 'Driver role required' })
      return
    }
    try {
      const driverResult = await getPool().query<{ id: string; full_name: string; email: string | null; phone: string | null; status: DriverStatus; created_at: Date | string }>(
        'SELECT id::text, full_name, email, phone, status, created_at FROM drivers WHERE tenant_id = $1 AND user_id = $2',
        [response.locals.tenantDbId, response.locals.authUser.id],
      )
      const driver = driverResult.rows[0]
      if (!driver) {
        response.status(404).json({ error: 'Driver profile not linked' })
        return
      }
      const assignments = await getPool().query<{ id: string; vehicle_id: string; vehicle_label: string; assigned_from: string; assigned_to: string | null }>(`SELECT a.id::text, a.vehicle_id::text,
          concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS vehicle_label, a.assigned_from, a.assigned_to
        FROM vehicle_driver_assignments a JOIN vehicles v ON v.id = a.vehicle_id
        WHERE a.tenant_id = $1 AND a.driver_id = $2 AND a.assigned_to IS NULL ORDER BY a.assigned_from DESC`, [response.locals.tenantDbId, driver.id])
      const documents = await getPool().query<DocumentRow>(`SELECT id::text, vehicle_id::text, driver_id::text, document_type,
          document_number, issued_on::text, expires_on::text, notes, created_at FROM documents
        WHERE tenant_id = $1 AND (driver_id = $2 OR vehicle_id IN (SELECT vehicle_id FROM vehicle_driver_assignments WHERE tenant_id = $1 AND driver_id = $2 AND assigned_to IS NULL))
        ORDER BY expires_on ASC, created_at DESC`, [response.locals.tenantDbId, driver.id])
      const settlements = await getPool().query(`SELECT s.id::text, s.vehicle_id::text, concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS vehicle_label,
          s.period_start::text, s.period_end::text, s.status, s.gross_income, s.driver_expenses, s.fixed_amount, s.revenue_percent,
          s.owner_amount, s.driver_amount, s.closed_at FROM settlements s JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.tenant_id = $1 AND s.driver_id = $2 ORDER BY s.period_end DESC, s.created_at DESC`, [response.locals.tenantDbId, driver.id])
      response.json({
        profile: driverResponse(driver),
        vehicles: assignments.rows.map((assignment) => ({ id: assignment.vehicle_id, label: assignment.vehicle_label, assignedFrom: assignment.assigned_from, assignedTo: assignment.assigned_to })),
        documents: documents.rows.map((document) => documentResponse(document, document.driver_id ? 'driver' : 'vehicle')),
        settlements: settlements.rows.map((settlement) => ({ id: settlement.id, vehicleId: settlement.vehicle_id, vehicleLabel: settlement.vehicle_label, periodStart: settlement.period_start, periodEnd: settlement.period_end, status: settlement.status, grossIncome: Number(settlement.gross_income), driverExpenses: Number(settlement.driver_expenses), fixedAmount: Number(settlement.fixed_amount), revenuePercent: Number(settlement.revenue_percent), ownerAmount: Number(settlement.owner_amount), driverAmount: Number(settlement.driver_amount), closedAt: settlement.closed_at ? new Date(settlement.closed_at).toISOString() : null })),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/tenants/:tenantId/assignments', requireAuth, requireTenantMembership, async (_request, response, next) => {
    try {
      const result = await getPool().query<{
        id: string; vehicle_id: string; vehicle_label: string; driver_id: string; driver_name: string; assigned_from: string; assigned_to: string | null; created_at: Date
      }>(`SELECT a.id::text, a.vehicle_id::text, concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS vehicle_label,
                 a.driver_id::text, d.full_name AS driver_name, a.assigned_from, a.assigned_to, a.created_at
          FROM vehicle_driver_assignments a
          JOIN vehicles v ON v.id = a.vehicle_id
          JOIN drivers d ON d.id = a.driver_id
          WHERE a.tenant_id = $1 AND ($2::text <> 'driver' OR d.user_id = $3::bigint)
          ORDER BY a.assigned_from DESC, a.created_at DESC`, [response.locals.tenantDbId, response.locals.membershipRole, response.locals.authUser.id])
      response.json(result.rows.map((assignment) => ({
        id: assignment.id, vehicleId: assignment.vehicle_id, vehicleLabel: assignment.vehicle_label,
        driverId: assignment.driver_id, driverName: assignment.driver_name, assignedFrom: assignment.assigned_from,
        assignedTo: assignment.assigned_to, createdAt: new Date(assignment.created_at).toISOString(),
      })))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/assignments', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const vehicleId = parsePositiveInteger(request.body?.vehicleId)
    const driverId = parsePositiveInteger(request.body?.driverId)
    const assignedFrom = request.body?.assignedFrom === undefined ? new Date().toISOString().slice(0, 10) : parseDate(request.body?.assignedFrom)
    if (!vehicleId || !driverId || !assignedFrom) {
      response.status(400).json({ error: 'vehicleId, driverId and a valid assignedFrom are required' })
      return
    }
    try {
      const entities = await getPool().query(`SELECT v.id, d.id AS driver_id FROM vehicles v CROSS JOIN drivers d
        WHERE v.tenant_id = $1 AND d.tenant_id = $1 AND v.id = $2 AND d.id = $3`, [response.locals.tenantDbId, vehicleId, driverId])
      if (!entities.rows[0]) {
        response.status(404).json({ error: 'Vehicle or driver not found' })
        return
      }
      const result = await getPool().query<{ id: string }>(`INSERT INTO vehicle_driver_assignments
        (tenant_id, vehicle_id, driver_id, assigned_from) VALUES ($1, $2, $3, $4) RETURNING id::text`,
      [response.locals.tenantDbId, vehicleId, driverId, assignedFrom])
      const assignment = await getPool().query<{
        id: string; vehicle_id: string; vehicle_label: string; driver_id: string; driver_name: string; assigned_from: string; assigned_to: string | null; created_at: Date
      }>(`SELECT a.id::text, a.vehicle_id::text, concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS vehicle_label,
          a.driver_id::text, d.full_name AS driver_name, a.assigned_from, a.assigned_to, a.created_at
        FROM vehicle_driver_assignments a JOIN vehicles v ON v.id = a.vehicle_id JOIN drivers d ON d.id = a.driver_id
        WHERE a.id = $1`, [result.rows[0].id])
      const row = assignment.rows[0]
      response.status(201).json({ id: row.id, vehicleId: row.vehicle_id, vehicleLabel: row.vehicle_label, driverId: row.driver_id, driverName: row.driver_name, assignedFrom: row.assigned_from, assignedTo: row.assigned_to, createdAt: new Date(row.created_at).toISOString() })
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'This driver already has an active vehicle assignment' })
        return
      }
      next(error)
    }
  })

  app.patch('/api/tenants/:tenantId/assignments/:assignmentId', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const assignmentId = parsePositiveInteger(request.params.assignmentId)
    const assignedTo = parseDate(request.body?.assignedTo)
    if (!assignmentId || !assignedTo) {
      response.status(400).json({ error: 'assignmentId and a valid assignedTo are required' })
      return
    }
    try {
      const result = await getPool().query(`UPDATE vehicle_driver_assignments SET assigned_to = $1
        WHERE id = $2 AND tenant_id = $3 AND assigned_to IS NULL RETURNING id`, [assignedTo, assignmentId, response.locals.tenantDbId])
      if (!result.rows[0]) {
        response.status(404).json({ error: 'Active assignment not found' })
        return
      }
      response.json({ id: String(result.rows[0].id), assignedTo })
    } catch (error) {
      next(error)
    }
  })

  const listDocuments = async (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const requestedVehicleId = request.query.vehicleId ?? request.params.vehicleId
    const requestedDriverId = request.query.driverId ?? request.params.driverId
    const vehicleId = requestedVehicleId ? parsePositiveInteger(requestedVehicleId) : undefined
    const driverId = requestedDriverId ? parsePositiveInteger(requestedDriverId) : undefined
    if ((requestedVehicleId && !vehicleId) || (requestedDriverId && !driverId) || (vehicleId && driverId)) {
      response.status(400).json({ error: 'vehicleId and driverId must be valid and mutually exclusive filters' })
      return
    }
    try {
      const target = vehicleId ? 'vehicle' : driverId ? 'driver' : undefined
      if (vehicleId || driverId) {
        const entityTable = vehicleId ? 'vehicles' : 'drivers'
        const entityId = vehicleId ?? driverId
        const entity = await getPool().query(`SELECT id FROM ${entityTable} WHERE id = $1 AND tenant_id = $2`, [entityId, response.locals.tenantDbId])
        if (!entity.rows[0]) {
          response.status(404).json({ error: 'Vehicle or driver not found' })
          return
        }
      }

      const result = await getPool().query<DocumentRow>(`SELECT id::text, vehicle_id::text, driver_id::text, document_type,
          document_number, issued_on::text, expires_on::text, notes, created_at
        FROM documents
        WHERE tenant_id = $1 AND ($2::bigint IS NULL OR vehicle_id = $2::bigint)
          AND ($3::bigint IS NULL OR driver_id = $3::bigint)
          AND ($4::text <> 'driver' OR driver_id IN (SELECT id FROM drivers WHERE user_id = $5::bigint)
            OR vehicle_id IN (SELECT a.vehicle_id FROM vehicle_driver_assignments a JOIN drivers d ON d.id = a.driver_id WHERE a.assigned_to IS NULL AND d.user_id = $5::bigint))
        ORDER BY expires_on ASC, created_at DESC`, [response.locals.tenantDbId, vehicleId ?? null, driverId ?? null, response.locals.membershipRole, response.locals.authUser.id])
      const documents = result.rows.map((row) => documentResponse(row, target ?? (row.vehicle_id ? 'vehicle' : 'driver')))
      if (target) {
        const existingTypes = new Set(documents.map((document) => document.documentType))
        const missing = documentDefinitions[target]
          .filter((definition) => !existingTypes.has(definition.type))
          .map((definition) => ({
            id: null,
            subject: target,
            vehicleId: vehicleId ? String(vehicleId) : null,
            driverId: driverId ? String(driverId) : null,
            documentType: definition.type,
            label: definition.label,
            documentNumber: null,
            issuedOn: null,
            expiresOn: null,
            notes: null,
            status: 'faltante' as const,
            createdAt: null,
          }))
        response.json([...documents, ...missing])
        return
      }
      response.json(documents)
    } catch (error) {
      next(error)
    }
  }

  const createDocument = async (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const input = documentInput(request.body)
    if ('error' in input) {
      response.status(400).json({ error: input.error })
      return
    }
    try {
      const entityTable = input.vehicleId ? 'vehicles' : 'drivers'
      const entityId = input.vehicleId ?? input.driverId
      const entity = await getPool().query(`SELECT id FROM ${entityTable} WHERE id = $1 AND tenant_id = $2`, [entityId, response.locals.tenantDbId])
      if (!entity.rows[0]) {
        response.status(404).json({ error: 'Vehicle or driver not found' })
        return
      }
      const result = await getPool().query<DocumentRow>(`INSERT INTO documents
          (tenant_id, vehicle_id, driver_id, document_type, document_number, issued_on, expires_on, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id::text, vehicle_id::text, driver_id::text, document_type, document_number,
          issued_on::text, expires_on::text, notes, created_at`,
      [response.locals.tenantDbId, input.vehicleId, input.driverId, input.documentType, input.documentNumber, input.issuedOn, input.expiresOn, input.notes])
      response.status(201).json(documentResponse(result.rows[0], input.vehicleId ? 'vehicle' : 'driver'))
    } catch (error) {
      next(error)
    }
  }

  app.get('/api/tenants/:tenantId/documents', requireAuth, requireTenantMembership, listDocuments)
  app.post('/api/tenants/:tenantId/documents', requireAuth, requireTenantMembership, requireFleetManager, createDocument)
  app.get('/api/tenants/:tenantId/vehicles/:vehicleId/documents', requireAuth, requireTenantMembership, async (request, response, next) => {
    await listDocuments(request, response, next)
  })
  app.get('/api/tenants/:tenantId/drivers/:driverId/documents', requireAuth, requireTenantMembership, async (request, response, next) => {
    await listDocuments(request, response, next)
  })
  app.post('/api/tenants/:tenantId/vehicles/:vehicleId/documents', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    request.body = { ...request.body, vehicleId: request.params.vehicleId }
    await createDocument(request, response, next)
  })
  app.post('/api/tenants/:tenantId/drivers/:driverId/documents', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    request.body = { ...request.body, driverId: request.params.driverId }
    await createDocument(request, response, next)
  })

  app.get('/api/tenants/:tenantId/financial-movements', requireAuth, requireTenantMembership, async (request, response, next) => {
    const from = request.query.from ? parseDate(request.query.from) : undefined
    const to = request.query.to ? parseDate(request.query.to) : undefined
    const vehicleId = request.query.vehicleId ? parsePositiveInteger(request.query.vehicleId) : undefined
    if ((request.query.from && !from) || (request.query.to && !to) || (request.query.vehicleId && !vehicleId)) {
      response.status(400).json({ error: 'from, to and vehicleId must be valid filters' })
      return
    }
    try {
      const params = [response.locals.tenantDbId, from ?? null, to ?? null, vehicleId ?? null, response.locals.membershipRole, response.locals.authUser.id]
      const result = await getPool().query<{
        id: string; vehicle_id: string; driver_id: string | null; kind: MovementKind; category: string; amount: string; occurred_on: string; notes: string | null; application_slug: string | null; trip_count: number | null; recipient: MovementRecipient | null; created_at: Date
      }>(`SELECT id::text, vehicle_id::text, driver_id::text, kind, category, amount, occurred_on::text, notes, application_slug, trip_count, recipient, created_at
        FROM financial_movements
        WHERE tenant_id = $1 AND ($2::date IS NULL OR occurred_on >= $2::date)
          AND ($3::date IS NULL OR occurred_on <= $3::date)
          AND ($4::bigint IS NULL OR vehicle_id = $4::bigint)
          AND ($5::text <> 'driver' OR driver_id IN (SELECT id FROM drivers WHERE user_id = $6::bigint))
        ORDER BY occurred_on DESC, created_at DESC`, params)
      const movements = result.rows.map(movementResponse)
      const income = movements.filter((movement) => movement.kind === 'income').reduce((sum, movement) => sum + movement.amount, 0)
      const expenses = movements.filter((movement) => movement.kind === 'expense').reduce((sum, movement) => sum + movement.amount, 0)
      response.json({ movements, totals: { income, expenses, profit: income - expenses } })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/financial-movements', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const vehicleId = parsePositiveInteger(request.body?.vehicleId)
    const driverId = request.body?.driverId === undefined || request.body?.driverId === null || request.body?.driverId === '' ? null : parsePositiveInteger(request.body?.driverId)
    const kind = request.body?.kind as MovementKind
    const category = requiredText(request.body?.category)
    const amount = parseAmount(request.body?.amount)
    const occurredOn = parseDate(request.body?.occurredOn)
    const notes = request.body?.notes === undefined || request.body?.notes === null || request.body?.notes === '' ? null : requiredText(request.body?.notes)
    const applicationSlug = request.body?.applicationSlug === undefined || request.body?.applicationSlug === null || request.body?.applicationSlug === '' ? null : requiredText(request.body?.applicationSlug)?.toLowerCase()
    const tripCount = parseTripCount(request.body?.tripCount)
    const recipient = request.body?.recipient === undefined || request.body?.recipient === null || request.body?.recipient === '' ? null : request.body.recipient as MovementRecipient
    const productionFieldsValid = kind !== 'income' || (!!applicationSlug && tripCount !== undefined && ['owner', 'driver'].includes(recipient ?? ''))
    const applicationSlugValid = applicationSlug === null || (typeof applicationSlug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(applicationSlug))
    const recipientValid = recipient === null || ['owner', 'driver'].includes(recipient)
    if (!vehicleId || (request.body?.driverId !== undefined && driverId === undefined) || !['income', 'expense'].includes(kind) || !category || category.length > 80 || !amount || !occurredOn || (request.body?.notes && !notes) || !productionFieldsValid || !applicationSlugValid || !recipientValid) {
      response.status(400).json({ error: 'vehicleId, kind, category, positive amount and occurredOn are required; income also requires applicationSlug, tripCount and recipient' })
      return
    }
    try {
      const entities = await getPool().query<{ id: string; application_slugs: string[] }>(`SELECT v.id, v.application_slugs FROM vehicles v
        WHERE v.tenant_id = $1 AND v.id = $2 AND ($3::bigint IS NULL OR EXISTS
          (SELECT 1 FROM drivers d WHERE d.id = $3::bigint AND d.tenant_id = $1))`, [response.locals.tenantDbId, vehicleId, driverId])
      if (!entities.rows[0]) {
        response.status(404).json({ error: 'Vehicle or driver not found' })
        return
      }
      if (kind === 'income') {
        const application = await getPool().query<{ slug: string }>('SELECT slug FROM tenant_applications WHERE tenant_id = $1 AND slug = $2 AND enabled = TRUE', [response.locals.tenantDbId, applicationSlug])
        if (!application.rows[0] || !entities.rows[0].application_slugs.includes(applicationSlug!)) {
          response.status(400).json({ error: 'applicationSlug must be enabled for this tenant and vehicle' })
          return
        }
      }
      const result = await getPool().query<{
        id: string; vehicle_id: string; driver_id: string | null; kind: MovementKind; category: string; amount: string; occurred_on: string; notes: string | null; application_slug: string | null; trip_count: number | null; recipient: MovementRecipient | null; created_at: Date
      }>(`INSERT INTO financial_movements (tenant_id, vehicle_id, driver_id, kind, category, amount, occurred_on, notes, application_slug, trip_count, recipient)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id::text, vehicle_id::text, driver_id::text, kind, category, amount, occurred_on::text, notes, application_slug, trip_count, recipient, created_at`,
      [response.locals.tenantDbId, vehicleId, driverId, kind, category, amount, occurredOn, notes, applicationSlug, tripCount ?? null, recipient])
      response.status(201).json(movementResponse(result.rows[0]))
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/tenants/:tenantId/financial-movements/:movementId', requireAuth, requireTenantMembership, requireFleetManager, async (request, response, next) => {
    const movementId = parsePositiveInteger(request.params.movementId)
    if (!movementId) {
      response.status(400).json({ error: 'movementId must be a positive integer' })
      return
    }
    try {
      const result = await getPool().query('DELETE FROM financial_movements WHERE id = $1 AND tenant_id = $2 RETURNING id', [movementId, response.locals.tenantDbId])
      if (!result.rows[0]) {
        response.status(404).json({ error: 'Financial movement not found' })
        return
      }
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/tenants/:tenantId/settlements', requireAuth, requireTenantMembership, async (request, response, next) => {
    try {
      const driverFilter = response.locals.membershipRole === 'driver'
        ? (await getPool().query<{ id: string }>('SELECT id::text FROM drivers WHERE tenant_id = $1 AND user_id = $2', [response.locals.tenantDbId, response.locals.authUser.id])).rows[0]?.id ?? null
        : (request.query.driverId ? parsePositiveInteger(request.query.driverId) ?? null : null)
      if (response.locals.membershipRole === 'driver' && !driverFilter) {
        response.status(404).json({ error: 'Driver profile not linked' })
        return
      }
      const result = await getPool().query(`
        SELECT s.id::text, s.driver_id::text, d.full_name AS driver_name, s.vehicle_id::text,
               concat(v.brand, ' ', v.model, ' · ', v.license_plate) AS vehicle_label,
               s.period_start::text, s.period_end::text, s.status, s.gross_income,
               s.driver_expenses, s.fixed_amount, s.revenue_percent, s.owner_amount, s.driver_amount,
               s.closed_at, s.created_at
        FROM settlements s
        JOIN drivers d ON d.id = s.driver_id
        JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.tenant_id = $1 AND ($2::bigint IS NULL OR s.driver_id = $2::bigint)
        ORDER BY s.period_end DESC, s.created_at DESC
      `, [response.locals.tenantDbId, driverFilter])
      response.json(result.rows.map((settlement) => ({
        id: settlement.id, driverId: settlement.driver_id, driverName: settlement.driver_name,
        vehicleId: settlement.vehicle_id, vehicleLabel: settlement.vehicle_label,
        periodStart: settlement.period_start, periodEnd: settlement.period_end, status: settlement.status,
        grossIncome: Number(settlement.gross_income), driverExpenses: Number(settlement.driver_expenses),
        fixedAmount: Number(settlement.fixed_amount), revenuePercent: Number(settlement.revenue_percent),
        ownerAmount: Number(settlement.owner_amount), driverAmount: Number(settlement.driver_amount),
        closedAt: settlement.closed_at ? new Date(settlement.closed_at).toISOString() : null,
      })))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/settlement-rules', requireAuth, requireTenantMembership, async (request, response, next) => {
    if (response.locals.membershipRole === 'driver') {
      response.status(403).json({ error: 'Only owners and operators can manage settlement rules' })
      return
    }
    const input = settlementInput(request.body)
    if ('error' in input) {
      response.status(400).json({ error: input.error })
      return
    }
    try {
      const entities = await getPool().query(`SELECT v.id FROM vehicles v CROSS JOIN drivers d WHERE v.tenant_id = $1 AND d.tenant_id = $1 AND v.id = $2 AND d.id = $3`, [response.locals.tenantDbId, input.vehicleId, input.driverId])
      if (!entities.rows[0]) {
        response.status(404).json({ error: 'Vehicle or driver not found' })
        return
      }
      const result = await getPool().query(`
        INSERT INTO settlement_rules (tenant_id, driver_id, vehicle_id, fixed_amount, revenue_percent, valid_from)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id::text, driver_id::text AS "driverId", vehicle_id::text AS "vehicleId", fixed_amount, revenue_percent, valid_from::text AS "validFrom"
      `, [response.locals.tenantDbId, input.driverId, input.vehicleId, input.fixedAmount, input.revenuePercent, input.periodStart])
      const rule = result.rows[0]
      response.status(201).json({ ...rule, fixedAmount: Number(rule.fixedAmount), revenuePercent: Number(rule.revenuePercent) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/settlements/preview', requireAuth, requireTenantMembership, async (request, response, next) => {
    if (response.locals.membershipRole === 'driver') {
      response.status(403).json({ error: 'Only owners and operators can preview settlements' })
      return
    }
    const input = settlementInput(request.body)
    if ('error' in input) {
      response.status(400).json({ error: input.error })
      return
    }
    try {
      const result = await getPool().query<{ income: string; expenses: string }>(`
        SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::text AS income,
               COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::text AS expenses
        FROM financial_movements
        WHERE tenant_id = $1 AND vehicle_id = $2 AND driver_id = $3 AND occurred_on BETWEEN $4::date AND $5::date
      `, [response.locals.tenantDbId, input.vehicleId, input.driverId, input.periodStart, input.periodEnd])
      const grossIncome = Number(result.rows[0]?.income ?? 0)
      const driverExpenses = Number(result.rows[0]?.expenses ?? 0)
      const ownerAmount = Number(input.fixedAmount) + grossIncome * Number(input.revenuePercent) / 100
      const driverAmount = grossIncome - ownerAmount - driverExpenses
      response.json({ ...input, grossIncome, driverExpenses, ownerAmount, driverAmount })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/tenants/:tenantId/settlements', requireAuth, requireTenantMembership, async (request, response, next) => {
    if (response.locals.membershipRole === 'driver') {
      response.status(403).json({ error: 'Only owners and operators can create settlements' })
      return
    }
    const input = settlementInput(request.body)
    if ('error' in input) {
      response.status(400).json({ error: input.error })
      return
    }
    try {
      const totals = await getPool().query<{ income: string; expenses: string }>(`
        SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::text AS income,
               COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::text AS expenses
        FROM financial_movements
        WHERE tenant_id = $1 AND vehicle_id = $2 AND driver_id = $3 AND occurred_on BETWEEN $4::date AND $5::date
      `, [response.locals.tenantDbId, input.vehicleId, input.driverId, input.periodStart, input.periodEnd])
      const grossIncome = Number(totals.rows[0]?.income ?? 0)
      const driverExpenses = Number(totals.rows[0]?.expenses ?? 0)
      const ownerAmount = Number(input.fixedAmount) + grossIncome * Number(input.revenuePercent) / 100
      const driverAmount = grossIncome - ownerAmount - driverExpenses
      const result = await getPool().query(`
        INSERT INTO settlements (tenant_id, driver_id, vehicle_id, period_start, period_end, gross_income, driver_expenses, fixed_amount, revenue_percent, owner_amount, driver_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id::text
      `, [response.locals.tenantDbId, input.driverId, input.vehicleId, input.periodStart, input.periodEnd, grossIncome, driverExpenses, input.fixedAmount, input.revenuePercent, ownerAmount, driverAmount])
      response.status(201).json({ id: result.rows[0].id, status: 'draft', grossIncome, driverExpenses, ownerAmount, driverAmount })
    } catch (error) {
      if (isUniqueViolation(error)) {
        response.status(409).json({ error: 'A settlement already exists for this driver, vehicle and period' })
        return
      }
      next(error)
    }
  })

  app.patch('/api/tenants/:tenantId/settlements/:settlementId/close', requireAuth, requireTenantMembership, async (request, response, next) => {
    if (response.locals.membershipRole === 'driver') {
      response.status(403).json({ error: 'Only owners and operators can close settlements' })
      return
    }
    const settlementId = parsePositiveInteger(request.params.settlementId)
    if (!settlementId) {
      response.status(400).json({ error: 'settlementId must be a positive integer' })
      return
    }
    try {
      const result = await getPool().query(`UPDATE settlements SET status = 'closed', closed_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'draft' RETURNING id::text, status, closed_at`, [settlementId, response.locals.tenantDbId])
      if (!result.rows[0]) {
        response.status(404).json({ error: 'Draft settlement not found' })
        return
      }
      response.json({ id: result.rows[0].id, status: result.rows[0].status, closedAt: new Date(result.rows[0].closed_at).toISOString() })
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error)
    response.status(503).json({ error: 'Database unavailable' })
  })

  return app
}

function requireFleetManager(_request: express.Request, response: express.Response, next: express.NextFunction) {
  if (response.locals.membershipRole === 'driver') {
    response.status(403).json({ error: 'Only owners and operators can modify fleet data' })
    return
  }
  next()
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}




