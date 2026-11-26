import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

process.env.NODE_ENV = 'test'
const root = resolve(import.meta.dirname, '..')
const env = Object.fromEntries((await readFile(resolve(root, '.local-data/postgis.env'), 'utf8'))
  .split(/\r?\n/).filter(line => line.includes('=')).map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]
  }))
const db = new pg.Client({ host: '127.0.0.1', port: 5432, database: env.POSTGRES_DB,
  user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD })
const { app } = await import('../apps/api/dist/server.js')
await app.ready(); await db.connect()
const username = `library_test_${randomBytes(5).toString('hex')}`
async function configuredLibrary(filename) {
  try {
    return JSON.parse(await readFile(resolve(root, '.local-data', filename), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
try {
  const password = randomBytes(16).toString('hex'), salt = randomBytes(16).toString('hex')
  await db.query('INSERT INTO renewal.app_users(username,salt,password_hash) VALUES($1,$2,$3)',
    [username, salt, scryptSync(password, salt, 32).toString('hex')])
  const login = async (user, pass) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/session', payload: { username: user, password: pass } })
    assert.equal(response.statusCode, 200)
    return response.headers['set-cookie'].split(';')[0]
  }
  const staff = await login(username, password)
  const admin = await login('admin', (await readFile(resolve(root, '.local-data/shared-admin.txt'), 'utf8')).trim())
  for (const url of ['/api/v1/libraries/partners', '/api/v1/libraries/scenes',
    '/api/v1/libraries/partners/export', '/api/v1/libraries/scenes/source?file=01-guess.docx']) {
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie: staff } })).statusCode, 403, url)
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url)
  }
  const get = url => app.inject({ method: 'GET', url, headers: { cookie: admin } })
  const partners = await configuredLibrary('partner-library.json')
  for (const url of ['/api/v1/libraries/partners', '/api/v1/libraries/partners/export']) {
    const response = await get(url)
    assert.equal(response.statusCode, partners ? 200 : 503)
    if (partners) assert.equal(response.json().records.length, partners.records.length)
  }
  const scenes = await configuredLibrary('scenario-library.json')
  const response = await get('/api/v1/libraries/scenes')
  assert.equal(response.statusCode, scenes ? 200 : 503)
  if (scenes) {
    assert.equal(response.json().records.length, scenes.records.length)
    const firstSource = scenes.records.find(row => row['来源文件'])?.['来源文件']
    if (firstSource) {
      const original = await get('/api/v1/libraries/scenes/source?file=' + encodeURIComponent(firstSource))
      assert.equal(original.statusCode, 200)
      assert.equal(original.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    }
    const absentFile = `00-${randomBytes(12).toString('hex')}.docx`
    assert.equal((await get('/api/v1/libraries/scenes/source?file=' + absentFile)).statusCode, 404)
  }
  console.log('PASS: resource/scenario catalogs, original and export are admin-only')
} finally {
  await db.query('DELETE FROM renewal.app_users WHERE username=$1', [username]).catch(() => {})
  await db.end(); await app.close()
}
