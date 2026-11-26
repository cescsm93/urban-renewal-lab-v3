import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { actor, HttpProblem } from './auth.js'
import { pool } from './db.js'

const local = resolve(import.meta.dirname, '../../../.local-data')
const files = { partners: 'partner-library.json', scenes: 'scenario-library.json' } as const
type Kind = keyof typeof files
type Library = { kind: string, source?: string, fields?: string[], records: Record<string, unknown>[], references?: unknown[] }

async function adminOnly(request: Parameters<typeof actor>[0]) {
  const who = await actor(request)
  // The four library catalogs are private even when a colleague can query them through Copilot.
  if (!who.admin) throw new HttpProblem(403, 'FORBIDDEN', '此资料库仅管理员可查看')
}

function kindOf(value: string): Kind {
  if (value !== 'partners' && value !== 'scenes') throw new HttpProblem(404, 'NOT_FOUND', '资料库不存在')
  return value
}

async function library(kind: Kind): Promise<Library> {
  try {
    const path = resolve(local, files[kind])
    if ((await stat(path)).size > 5 * 1024 * 1024) throw Error('too large')
    const data = JSON.parse(await readFile(path, 'utf8')) as Library
    if (!Array.isArray(data.records)) throw Error('invalid records')
    return data
  } catch {
    throw new HttpProblem(503, 'LIBRARY_UNAVAILABLE', '本机资料库暂时不可读')
  }
}

export function registerLibraries(app: FastifyInstance) {
  app.get('/api/v1/libraries/project-catalog', async request => {
    await adminOnly(request)
    const result = await pool.query(`
      SELECT c.catalog_kind, w.id::text AS "workspaceId", w.name,
             coalesce(layers.items, '[]'::jsonb) AS layers
      FROM renewal.workspace_catalog c
      JOIN renewal.workspaces w ON w.id = c.workspace_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'layerId', l.id::text, 'name', l.name, 'kind', l.kind,
          'featureCount', (SELECT count(*) FROM renewal.features f WHERE f.layer_id = l.id)
        ) ORDER BY l.id) AS items
        FROM renewal.layers l WHERE l.workspace_id = w.id
      ) layers ON true
      WHERE c.catalog_kind IN ('province', 'company')
      ORDER BY w.id`)
    return { groups: ['province', 'company'].map(kind => ({
      kind, workspaces: result.rows.filter(row => row.catalog_kind === kind)
        .map(({ workspaceId, name, layers }) => ({ workspaceId, name, layers }))
    })) }
  })

  app.get<{ Params: { kind: string } }>('/api/v1/libraries/:kind', async request => {
    await adminOnly(request)
    return library(kindOf(request.params.kind))
  })

  app.get('/api/v1/libraries/partners/export', async (request, reply) => {
    await adminOnly(request)
    const data = await library('partners')
    return reply.header('Content-Disposition', 'attachment; filename="partner-library.json"')
      .header('Cache-Control', 'private, no-store').send(data)
  })

  app.get<{ Querystring: { file?: string } }>('/api/v1/libraries/scenes/source', async (request, reply) => {
    await adminOnly(request)
    const name = request.query.file || ''
    const data = await library('scenes')
    if (!/^\d{2}-[^/\\]+\.docx$/i.test(name) || basename(name) !== name ||
      !data.records.some(row => row['来源文件'] === name))
      throw new HttpProblem(404, 'NOT_FOUND', '原文件不在场景库内')
    const path = resolve(local, 'scenario-docs', name)
    let size: number
    try {
      const info = await stat(path)
      if (!info.isFile()) throw Error('not a file')
      size = info.size
    } catch { throw new HttpProblem(404, 'NOT_FOUND', '原文件不存在') }
    return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header('Content-Length', size).header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff').send(createReadStream(path))
  })
}
