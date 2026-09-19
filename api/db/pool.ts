import { Pool } from 'pg'
import '../config.js'

let pool: Pool | undefined

export function getPool() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is required for database-backed endpoints')
  }

  pool ??= new Pool({ connectionString })
  return pool
}

export async function closePool() {
  await pool?.end()
  pool = undefined
}
