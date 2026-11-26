import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { loginInput, scope } from '@renewal/contracts'
import type { Scope } from '@renewal/contracts'
import { pool } from './db.js'

export class HttpProblem extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message) }
}
export type Actor = { username: string, admin: boolean, expiresAt: string }
const COOKIE = 'renewal_session'
const lifetimeMs = 8 * 3600 * 1000
const attempts = new Map<string, { start: number, count: number }>()
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

function tokenFrom(request: FastifyRequest) {
  return String(request.headers.cookie || '').match(/(?:^|;\s*)renewal_session=([a-f0-9]{64})(?:;|$)/)?.[1]
}
export async function actor(request: FastifyRequest): Promise<Actor> {
  const token = tokenFrom(request)
  if (!token) throw new HttpProblem(401, 'UNAUTHENTICATED', '请先登录')
  const row = await pool.query(`SELECT u.username,s.expires_at FROM renewal.app_sessions s
    JOIN renewal.app_users u ON u.username=s.username
    WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND NOT u.disabled`, [sha(token)])
  if (!row.rowCount) throw new HttpProblem(401, 'SESSION_EXPIRED', '登录已过期，请重新登录')
  const username = row.rows[0].username as string
  return { username, admin: username === 'admin', expiresAt: new Date(row.rows[0].expires_at).toISOString() }
}
export async function hasScope(who: Actor, wanted: Scope, resourceType = '*', resourceId = '*') {
  if (who.admin) return true
  if (wanted === 'knowledge:query' || wanted === 'archive:view' || wanted === 'report:view') return true
  if (wanted === 'archive:edit') {
    const legacy = await pool.query('SELECT 1 FROM renewal.archive_editors WHERE username=$1', [who.username])
    if (legacy.rowCount) return true
  }
  const row = await pool.query(`SELECT 1 FROM renewal.app_grants WHERE username=$1 AND scope=$2
    AND (resource_type='*' OR resource_type=$3) AND (resource_id='*' OR resource_id=$4) LIMIT 1`,
    [who.username, wanted, resourceType, resourceId])
  return !!row.rowCount
}
export async function requireScope(request: FastifyRequest, wanted: Scope, type = '*', id = '*') {
  const who = await actor(request)
  if (!await hasScope(who, wanted, type, id)) throw new HttpProblem(403, 'FORBIDDEN', '无权访问此资料')
  return who
}
function cookie(reply: FastifyReply, value: string, age: number) {
  reply.header('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.RENEWAL_HTTPS === '1' ? '; Secure' : ''}`)
  reply.header('Cache-Control', 'private, no-store')
}
export function registerAuth(app: FastifyInstance) {
  app.addHook('preHandler', async request => {
    if (!['POST','PUT','PATCH','DELETE'].includes(request.method)) return
    const origin = request.headers.origin
    if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`)
      throw new HttpProblem(403, 'ORIGIN_DENIED', '仅允许同源提交')
  })
  app.post('/api/v1/session', async (request, reply) => {
    const input = loginInput.safeParse(request.body)
    if (!input.success) throw new HttpProblem(400, 'BAD_INPUT', '账号或口令格式无效')
    const ip = request.ip
    const now = Date.now()
    const prior = attempts.get(ip)
    const entry = prior && now - prior.start < 60000 ? prior : { start: now, count: 0 }
    entry.count++
    attempts.set(ip, entry)
    if (entry.count > 5) throw new HttpProblem(429, 'RATE_LIMIT', '尝试过多，请一分钟后重试')
    const username = input.data.username.toLowerCase()
    const row = await pool.query('SELECT salt,password_hash FROM renewal.app_users WHERE username=$1 AND NOT disabled', [username])
    const salt = row.rows[0]?.salt || 'invalid-user'
    const candidate = scryptSync(input.data.password, salt, 32)
    const stored = Buffer.from(row.rows[0]?.password_hash || '0'.repeat(64), 'hex')
    if (!row.rowCount || stored.length !== candidate.length || !timingSafeEqual(candidate, stored))
      throw new HttpProblem(401, 'BAD_CREDENTIALS', '账号或口令不正确')
    attempts.delete(ip)
    const token = randomBytes(32).toString('hex')
    const expires = new Date(now + lifetimeMs)
    await pool.query('INSERT INTO renewal.app_sessions(token_hash,username,expires_at) VALUES($1,$2,$3)',
      [sha(token), username, expires])
    cookie(reply, token, lifetimeMs / 1000)
    return { ok: true }
  })
  app.get('/api/v1/me', async request => {
    const who = await actor(request)
    const grants = who.admin ? [...scope.options] : ['archive:view','knowledge:query','report:view']
    if (!who.admin) {
      if (await hasScope(who,'archive:edit')) grants.push('archive:edit')
      const extra = await pool.query('SELECT DISTINCT scope FROM renewal.app_grants WHERE username=$1', [who.username])
      for (const row of extra.rows) if (scope.safeParse(row.scope).success && !grants.includes(row.scope)) grants.push(row.scope)
    }
    return { userId: who.username, username: who.username, admin: who.admin,
      scopes: grants, expiresAt: who.expiresAt }
  })
  app.delete('/api/v1/session', async (request, reply) => {
    const token = tokenFrom(request)
    if (token) await pool.query('UPDATE renewal.app_sessions SET revoked_at=now() WHERE token_hash=$1', [sha(token)])
    cookie(reply, '', 0)
    return { ok: true }
  })
}
