import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const root = resolve(import.meta.dirname, '../../..')
const settings = Object.fromEntries(readFileSync(resolve(root, '.local-data/postgis.env'), 'utf8')
  .split(/\r?\n/).filter(line => line.includes('=')).map(line => {
    const at = line.indexOf('=')
    return [line.slice(0, at), line.slice(at + 1)]
  }))
export const pool = new pg.Pool({ host: '127.0.0.1', port: 5432,
  database: settings.POSTGRES_DB, user: settings.POSTGRES_USER,
  password: settings.POSTGRES_PASSWORD, max: 5, connectionTimeoutMillis: 2000 })

export async function platformReady() {
  try {
    const result = await pool.query("SELECT to_regclass('renewal.app_users') IS NOT NULL AS ready")
    return result.rows[0]?.ready === true
  } catch { return false }
}
