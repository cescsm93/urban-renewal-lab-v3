import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { projectSave } from '@renewal/contracts'
import { actor, HttpProblem } from './auth.js'
import type { Actor } from './auth.js'
import { pool } from './db.js'

const createInput = z.object({ name: z.string().trim().min(1).max(100), state: z.record(z.string(), z.unknown()) })
const memberInput = z.object({ username: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,31}$/), role: z.enum(['viewer','editor','none']) })
const idOf = (request: FastifyRequest<{ Params: { id: string } }>) => {
  const id = request.params.id
  if (!/^\d+$/.test(id)) throw new HttpProblem(400, 'BAD_ID', '项目编号无效')
  return id
}
const summary = (row: Record<string, unknown>, role: string) => ({
  id: String(row.id), name: row.name, version: row.version, role,
  updatedAt: new Date(String(row.updated_at)).toISOString(), updatedBy: row.updated_by
})
async function readProject(id: string, who: Actor) {
  const result = await pool.query(`SELECT p.*,m.role AS member_role FROM renewal.app_projects p
    LEFT JOIN renewal.app_project_members m ON m.project_id=p.id AND m.username=$2 WHERE p.id=$1`,
    [id, who.username])
  const row = result.rows[0]
  if (!row || (!who.admin && !row.member_role)) throw new HttpProblem(404, 'NOT_FOUND', '项目不存在或无访问权限')
  return { row, role: who.admin ? 'admin' : String(row.member_role) }
}

export function registerProjects(app: FastifyInstance) {
  app.get('/api/v1/projects', async request => {
    const who = await actor(request)
    const result = who.admin
      ? await pool.query('SELECT id,name,version,updated_at,updated_by FROM renewal.app_projects ORDER BY id DESC')
      : await pool.query(`SELECT p.id,p.name,p.version,p.updated_at,p.updated_by,m.role FROM renewal.app_projects p
          JOIN renewal.app_project_members m ON m.project_id=p.id AND m.username=$1 ORDER BY p.id DESC`, [who.username])
    return { projects: result.rows.map(row => summary(row, who.admin ? 'admin' : row.role)) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/projects/:id', async request => {
    const who = await actor(request)
    const { row, role } = await readProject(idOf(request), who)
    return { ...summary(row, role), state: row.payload }
  })
  app.post('/api/v1/projects', async (request, reply) => {
    const who = await actor(request)
    if (!who.admin) throw new HttpProblem(403, 'FORBIDDEN', '仅管理员可以创建共享项目')
    const input = createInput.safeParse(request.body)
    if (!input.success) throw new HttpProblem(400, 'BAD_INPUT', '项目名称或数据格式无效')
    const row = await pool.query(`INSERT INTO renewal.app_projects(name,payload,updated_by)
      VALUES($1,$2::jsonb,$3) RETURNING *`, [input.data.name, JSON.stringify(input.data.state), who.username])
    reply.code(201)
    return { ...summary(row.rows[0], 'admin'), state: row.rows[0].payload }
  })
  app.put<{ Params: { id: string } }>('/api/v1/projects/:id', async request => {
    const who = await actor(request)
    const id = idOf(request)
    const current = await readProject(id, who)
    if (!['admin','editor'].includes(current.role)) throw new HttpProblem(403, 'FORBIDDEN', '当前账号只有查看权限')
    const input = projectSave.safeParse(request.body)
    if (!input.success) throw new HttpProblem(400, 'BAD_INPUT', '保存内容或版本号无效')
    const result = await pool.query(`UPDATE renewal.app_projects SET payload=$1::jsonb,version=version+1,
      updated_at=now(),updated_by=$2 WHERE id=$3 AND version=$4 RETURNING *`,
      [JSON.stringify(input.data.state), who.username, id, input.data.expectedVersion])
    if (!result.rowCount) throw new HttpProblem(409, 'VERSION_CONFLICT', '项目已由他人更新；当前草稿仍在浏览器中，请核对新版后重试')
    return { ...summary(result.rows[0], current.role), state: result.rows[0].payload,
      savedDraftRevision: input.data.draftRevision }
  })
  app.get<{ Params: { id: string } }>('/api/v1/projects/:id/members', async request => {
    const who = await actor(request)
    if (!who.admin) throw new HttpProblem(403, 'FORBIDDEN', '只有管理员可查看成员')
    const id = idOf(request)
    await readProject(id, who)
    const rows = await pool.query('SELECT username,role FROM renewal.app_project_members WHERE project_id=$1 ORDER BY username', [id])
    return { members: rows.rows }
  })
  app.put<{ Params: { id: string } }>('/api/v1/projects/:id/members', async request => {
    const who = await actor(request)
    if (!who.admin) throw new HttpProblem(403, 'FORBIDDEN', '只有管理员可修改成员')
    const id = idOf(request)
    await readProject(id, who)
    const input = memberInput.safeParse(request.body)
    if (!input.success || input.data.username === 'admin') throw new HttpProblem(400, 'BAD_INPUT', '成员或权限无效')
    const user = await pool.query('SELECT 1 FROM renewal.app_users WHERE username=$1 AND NOT disabled', [input.data.username])
    if (!user.rowCount) throw new HttpProblem(404, 'NOT_FOUND', '成员账号不存在')
    if (input.data.role === 'none') await pool.query('DELETE FROM renewal.app_project_members WHERE project_id=$1 AND username=$2', [id,input.data.username])
    else await pool.query(`INSERT INTO renewal.app_project_members(project_id,username,role) VALUES($1,$2,$3)
      ON CONFLICT(project_id,username) DO UPDATE SET role=excluded.role`, [id,input.data.username,input.data.role])
    return { ok: true }
  })
}
