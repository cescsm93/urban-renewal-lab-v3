import { createRequire } from 'node:module'
import { createReadStream, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpProblem, requireScope } from './auth.js'

const require = createRequire(import.meta.url)
const knowledge = require('../../../lib/local-knowledge.cjs') as {
  queryPolicy(question: string, owner: boolean): Promise<unknown>,
  policyCatalog(): unknown[], indexedSourceFile(kind: string, path: string): string | null
}
const questionInput = z.object({ question: z.string().trim().min(1).max(300) })
let activeQueries = 0

export function registerKnowledge(app: FastifyInstance) {
  app.post('/api/v1/knowledge/query', async request => {
    const who = await requireScope(request, 'knowledge:query')
    const input = questionInput.safeParse(request.body)
    if (!input.success) throw new HttpProblem(400, 'BAD_INPUT', '请输入 300 字以内的问题')
    if (activeQueries >= 2) throw new HttpProblem(429, 'MODEL_BUSY', '本机模型正在处理其他问题，请稍后重试')
    activeQueries++
    try {
      const result = await knowledge.queryPolicy(input.data.question, who.admin) as {
        answer: string, scope: string | null, sources: Array<Record<string, unknown>>
      }
      return { ...result, sources: result.sources.map(source => who.admin && typeof source.openUrl === 'string' ?
        { ...source, openUrl: source.openUrl.replace('/api/local-knowledge/source', '/api/v1/knowledge/source') } : source) }
    }
    catch { throw new HttpProblem(503, 'KNOWLEDGE_UNAVAILABLE', '本机政策索引或 Ollama 暂时不可用') }
    finally { activeQueries-- }
  })
  app.get('/api/v1/knowledge/catalog', async request => {
    await requireScope(request, 'library:catalog')
    try { return { documents: knowledge.policyCatalog() } }
    catch { throw new HttpProblem(503, 'KNOWLEDGE_UNAVAILABLE', '本机政策目录暂时不可读') }
  })
  app.get<{ Querystring: { kind?: string, path?: string } }>('/api/v1/knowledge/source', async (request, reply) => {
    await requireScope(request, 'source:preview')
    const kind = request.query.kind || ''
    const relative = request.query.path || ''
    let file: string | null = null
    try { file = knowledge.indexedSourceFile(kind, relative) }
    catch { file = null }
    if (!file) throw new HttpProblem(404, 'NOT_FOUND', '原文件不存在或不在索引内')
    const stat = statSync(file)
    if (!stat.isFile()) throw new HttpProblem(404, 'NOT_FOUND', '原文件不可查看')
    const pdf = extname(file).toLowerCase() === '.pdf'
    let start = 0, end = stat.size - 1
    const range = request.headers.range
    if (range && pdf) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) throw new HttpProblem(416, 'BAD_RANGE', '文件范围无效')
      if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
      else start = Math.max(0, stat.size - Number(match[2]))
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size)
        throw new HttpProblem(416, 'BAD_RANGE', '文件范围无效')
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
    }
    reply.header('Content-Type', pdf ? 'application/pdf' : 'text/plain; charset=utf-8')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(basename(file))}`)
      .header('Content-Length', end - start + 1)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
    if (pdf) reply.header('Accept-Ranges', 'bytes')
    return reply.send(createReadStream(file, { start, end }))
  })
}
