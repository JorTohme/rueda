import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { closePool, getPool } from './db/pool.js'

function dateFromToday(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const server = createApp().listen(0)
await new Promise<void>((resolve) => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`
const suffix = Date.now().toString()
const email = `documents-${suffix}@example.test`
const documentIds: string[] = []
let driverId: string | undefined

try {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.DEMO_EMAIL ?? 'demo@rueda.local', password: process.env.DEMO_PASSWORD ?? 'demo-password' }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie)
  const headers = { cookie }

  const vehiclesResponse = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles`, { headers })
  assert.equal(vehiclesResponse.status, 200)
  const vehicles = await vehiclesResponse.json() as Array<{ id: string }>
  assert.ok(vehicles[0]?.id)
  const vehicleId = vehicles[0].id

  const missing = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles/${vehicleId}/documents`, { headers })
  assert.equal(missing.status, 200)
  const missingDocuments = await missing.json() as Array<{ status: string; documentType: string }>
  assert.ok(missingDocuments.some((document) => document.status === 'faltante' && document.documentType === 'insurance'))

  const invalid = await fetch(`${baseUrl}/api/tenants/demo-fleet/documents`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleId, documentType: 'insurance', expiresOn: 'not-a-date' }),
  })
  assert.equal(invalid.status, 400)

  for (const [documentType, days, expectedStatus] of [
    ['insurance', 60, 'vigente'],
    ['registration', 10, 'proximo_a_vencer'],
    ['technical_inspection', -2, 'vencido'],
  ] as const) {
    const created = await fetch(`${baseUrl}/api/tenants/demo-fleet/vehicles/${vehicleId}/documents`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ documentType, documentNumber: `${documentType}-${suffix}`, expiresOn: dateFromToday(days) }),
    })
    assert.equal(created.status, 201)
    const document = await created.json() as { id: string; status: string }
    documentIds.push(document.id)
    assert.equal(document.status, expectedStatus)
  }

  const documents = await fetch(`${baseUrl}/api/tenants/demo-fleet/documents?vehicleId=${vehicleId}`, { headers })
  assert.equal(documents.status, 200)
  const documentList = await documents.json() as Array<{ documentType: string; status: string }>
  assert.equal(documentList.filter((document) => document.status === 'faltante').length, 0)
  assert.ok(documentList.some((document) => document.documentType === 'insurance' && document.status === 'vigente'))

  const driverResponse = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: `Documents Driver ${suffix}`, email }),
  })
  assert.equal(driverResponse.status, 201)
  driverId = (await driverResponse.json() as { id: string }).id

  const driverDocument = await fetch(`${baseUrl}/api/tenants/demo-fleet/drivers/${driverId}/documents`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ documentType: 'license', expiresOn: dateFromToday(45) }),
  })
  assert.equal(driverDocument.status, 201)
  const driverDocumentBody = await driverDocument.json() as { id: string; subject: string }
  documentIds.push(driverDocumentBody.id)
  assert.equal(driverDocumentBody.subject, 'driver')

  const denied = await fetch(`${baseUrl}/api/tenants/other-fleet/vehicles/${vehicleId}/documents`, { headers })
  assert.equal(denied.status, 403)

  console.log('Documents database integration check passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  const pool = getPool()
  if (documentIds.length) await pool.query('DELETE FROM documents WHERE id = ANY($1::bigint[])', [documentIds])
  if (driverId) {
    await pool.query('DELETE FROM drivers WHERE id = $1', [driverId])
  }
  await closePool()
}
