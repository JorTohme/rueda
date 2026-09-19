import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool, closePool } from './pool.js'

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
const pool = getPool()
const client = await pool.connect()

try {
  await client.query('SELECT pg_advisory_lock(803206)')
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`)

  const migrations = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort()

  for (const name of migrations) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])
    if (applied.rowCount) continue

    const sql = await readFile(path.join(migrationsDirectory, name), 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
      await client.query('COMMIT')
      console.log(`Applied ${name}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(803206)')
  client.release()
  await closePool()
}
