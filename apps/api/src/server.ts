import Fastify from 'fastify'
import { apiError, capability } from '@renewal/contracts'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pool, platformReady } from './db.js'
import { registerAuth } from './auth.js'
import { registerProjects } from './projects.js'
import { registerArchive } from './archive.js'
import { registerKnowledge } from './knowledge.js'
import { registerImports } from './imports.js'
import { registerWorkflow } from './workflow.js'
import { registerLibraries } from './libraries.js'

const root = resolve(import.meta.dirname, '../../..')
const local = resolve(root, '.local-data')
const host = '127.0.0.1'
const port = Number(process.env.RENEWAL_API_PORT || 4190)
const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 })

const errorBody = (code: string, message: string, requestId?: string) =>
  apiError.parse({ error: { code, message, requestId } })

async function postgisStatus() {
  try {
    await pool.query('SELECT 1 FROM renewal.layers LIMIT 1')
    return { available: true, reason: null }
  } catch {
    return { available: false, reason: 'PostGIS 未启动或无法读取图层' }
  }
}

registerAuth(app)
registerProjects(app)
registerArchive(app)
registerKnowledge(app)
await registerImports(app)
registerWorkflow(app)
registerLibraries(app)
app.addHook('onSend', (_request, reply, payload, done) => {
  if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'private, no-store')
  done(null, payload)
})
app.get('/api/v1/health', async () => ({ service: 'renewal-fastify', status: 'ok' }))
app.get('/api/v1/capabilities', async () => {
  const postgis = await postgisStatus()
  const shared = await platformReady()
  let knowledge = false
  try {
    const config = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(resolve(local, 'knowledge-config.json'), 'utf8')))
    knowledge = typeof config.indexPath === 'string' && existsSync(config.indexPath) &&
      (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) })).ok
  } catch { knowledge = false }
  return {
    capabilities: [
      capability.parse({ id: 'archive', ...postgis, mock: false }),
      capability.parse({ id: 'shared-projects', available: shared, reason: shared ? null : 'PG 项目和会话表尚未就绪', mock: false }),
      capability.parse({ id: 'knowledge', available: knowledge, reason: knowledge ? null : '本机政策索引或 Ollama 未就绪', mock: false })
    ]
  }
})
app.setNotFoundHandler((request, reply) => reply.code(404).send(errorBody('NOT_FOUND', '接口不存在', request.id)))
app.setErrorHandler((error, request, reply) => {
  request.log.error(error)
  const failure = error as { statusCode?: number, code?: string, message?: string }
  const status = ['23514','22P02','22023','XX000'].includes(failure.code || '') ? 400 :
    ['ECONNREFUSED','ETIMEDOUT','ENOENT'].includes(failure.code || '') ? 503 :
    failure.statusCode && failure.statusCode >= 400 ? failure.statusCode : 500
  reply.code(status).send(errorBody(failure.code || 'INTERNAL_ERROR',
    status < 500 ? failure.message || '请求无效' : status === 503 ? '本机依赖暂时不可用' : '服务处理失败', request.id))
})

if (process.env.NODE_ENV !== 'test') {
  app.listen({ host, port }).catch(error => { app.log.error(error); process.exitCode = 1 })
}
export { app }
