const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const MAX_STATE_BYTES = 20 * 1024 * 1024;
const accountName = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readJson(req, limit = 4096) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw error(415, '请求必须使用 JSON');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw error(413, '数据超过容量限制');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!object(body)) throw Error();
    return body;
  } catch {
    throw error(400, '数据格式无效');
  }
}

function hash(password, salt) {
  return scryptSync(password, salt, 32);
}

function copyData(value, depth = 0) {
  if (depth > 64) throw error(400, '项目数据嵌套过深');
  if (Array.isArray(value)) return value.map(item => copyData(item, depth + 1));
  if (object(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key))
    .map(([key, item]) => [key, copyData(item, depth + 1)]));
  return value;
}

function validateState(input) {
  const point = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const ring = p => Array.isArray(p) && p.length >= 3 && p.every(point);
  const collection = c => object(c) && c.type === 'FeatureCollection' && Array.isArray(c.features) && c.features.every(f => object(f) && f.type === 'Feature' && object(f.geometry));
  const validResource = p => object(p) && ring(p.pts) &&
    ['name','type','stage','owner','mode','landNature','currentUse','plannedUse'].every(
      key => p[key] == null || typeof p[key] === 'string');
  if (!object(input) || !Array.isArray(input.projects) || input.projects.length > 10000 ||
      !input.projects.every(validResource) ||
      !Array.isArray(input.renewalAreas) ||
      !input.renewalAreas.every(a => object(a) && ring(a.pts) && Number.isFinite(a.areaHa) && Array.isArray(a.resourceIds) && a.resourceIds.length > 0 && a.resourceIds.every(id => Number.isInteger(id) && id >= 0 && id < input.projects.length)) ||
      !collection(input.importedReferenceGeoJSON) ||
      (input.studyLayers !== undefined && (!object(input.studyLayers) || !Object.values(input.studyLayers).every(collection)))) {
    throw error(400, '项目资源或图层格式不正确');
  }
  return copyData(input);
}

function openSharedStore(dir) {
  const db = new DatabaseSync(path.join(dir, 'shared-projects.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL,
      updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      project_id INTEGER REFERENCES projects(id), username TEXT REFERENCES users(username),
      role TEXT NOT NULL CHECK(role IN ('editor','viewer')), PRIMARY KEY(project_id, username)
    );
  `);
  const getUser = db.prepare('SELECT * FROM users WHERE username = ?');
  const putUser = db.prepare('INSERT INTO users VALUES (?, ?, ?)');
  const adminPasswordFile = path.join(dir, 'shared-admin.txt');
  if (!getUser.get('admin')) {
    if (!fs.existsSync(adminPasswordFile)) fs.writeFileSync(adminPasswordFile, randomBytes(18).toString('base64url'), { flag: 'wx' });
    const password = fs.readFileSync(adminPasswordFile, 'utf8').trim();
    const salt = randomBytes(16).toString('hex');
    putUser.run('admin', salt, hash(password, salt).toString('hex'));
  }
  const authenticate = (username, password) => {
    const row = getUser.get(username);
    const candidate = hash(password, row?.salt || 'invalid-user');
    return !!row && timingSafeEqual(candidate, Buffer.from(row.password_hash, 'hex'));
  };
  const getProject = db.prepare('SELECT * FROM projects WHERE id = ?');
  const getRole = db.prepare('SELECT role FROM members WHERE project_id = ? AND username = ?');
  const roleFor = (id, username) => username === 'admin' ? 'admin' : getRole.get(id, username)?.role;
  const metadata = (p, role) => ({
    id: p.id, name: p.name, version: p.version, role, updatedAt: p.updated_at, updatedBy: p.updated_by
  });
  const requireAdmin = username => {
    if (username !== 'admin') throw error(403, '仅管理员可以执行此操作');
  };
  const routes = async (req, url, username) => {
    const method = req.method;
    const endpoint = url.pathname;
    if (!username) throw error(403, '请用成员账号登录共享项目');
    if (endpoint === '/api/shared/me' && method === 'GET') return { username, admin: username === 'admin' };
    if (endpoint === '/api/shared/users' && method === 'GET') {
      requireAdmin(username);
      return { users: db.prepare("SELECT username FROM users WHERE username != 'admin' ORDER BY username").all().map(row => row.username) };
    }
    if (endpoint === '/api/shared/users' && method === 'POST') {
      requireAdmin(username);
      const data = await readJson(req);
      const name = String(data.username ?? '').trim().toLowerCase();
      if (!accountName.test(name) || name === 'admin') throw error(400, '账号使用 2–32 位小写字母、数字、点、下划线或连字符');
      const exists = !!getUser.get(name);
      if (exists && data.reset !== true) throw error(409, '账号已存在，可使用重置口令');
      if (!exists && data.reset === true) throw error(404, '账号不存在');
      const password = randomBytes(15).toString('base64url');
      const salt = randomBytes(16).toString('hex');
      const digest = hash(password, salt).toString('hex');
      if (exists) db.prepare('UPDATE users SET salt = ?, password_hash = ? WHERE username = ?').run(salt, digest, name);
      else putUser.run(name, salt, digest);
      return { username: name, password, reset: exists };
    }
    if (endpoint === '/api/shared/projects' && method === 'GET') {
      const rows = username === 'admin'
        ? db.prepare('SELECT id, name, version, updated_at, updated_by FROM projects ORDER BY id DESC').all()
        : db.prepare('SELECT p.id, p.name, p.version, p.updated_at, p.updated_by, m.role FROM projects p JOIN members m ON m.project_id = p.id WHERE m.username = ? ORDER BY p.id DESC').all(username);
      return { projects: rows.map(p => metadata(p, p.role || 'admin')) };
    }
    if (endpoint === '/api/shared/projects' && method === 'POST') {
      requireAdmin(username);
      const data = await readJson(req, MAX_STATE_BYTES);
      const name = String(data.name ?? '').trim();
      if (!name || name.length > 100) throw error(400, '请填写 1–100 字的项目名称');
      const state = validateState(data.state);
      const time = new Date().toISOString();
      const result = db.prepare('INSERT INTO projects(name,version,updated_at,updated_by,payload) VALUES (?,1,?,?,?)')
        .run(name, time, username, JSON.stringify(state));
      return { ...metadata(getProject.get(Number(result.lastInsertRowid)), 'admin'), state };
    }
    const match = endpoint.match(/^\/api\/shared\/projects\/(\d+)(\/members)?$/);
    if (!match) throw error(404, '接口不存在');
    const id = Number(match[1]);
    const project = getProject.get(id);
    const role = roleFor(id, username);
    if (!project || !role) throw error(404, '项目不存在或无访问权限');
    if (match[2]) {
      requireAdmin(username);
      if (method === 'GET') return { members: db.prepare('SELECT username, role FROM members WHERE project_id = ? ORDER BY username').all(id) };
      if (method === 'PUT') {
        const data = await readJson(req);
        const name = String(data.username ?? '').trim().toLowerCase();
        if (name === 'admin' || !getUser.get(name)) throw error(400, '请先创建该成员账号');
        if (data.role === 'none') db.prepare('DELETE FROM members WHERE project_id = ? AND username = ?').run(id, name);
        else {
          if (!['viewer', 'editor'].includes(data.role)) throw error(400, '项目权限无效');
          db.prepare('INSERT INTO members VALUES (?, ?, ?) ON CONFLICT(project_id, username) DO UPDATE SET role = excluded.role')
            .run(id, name, data.role);
        }
        return { ok: true };
      }
      throw error(405, '请求方式不支持');
    }
    if (method === 'GET') {
      if (url.searchParams.get('version') === String(project.version)) return metadata(project, role);
      return { ...metadata(project, role), state: JSON.parse(project.payload) };
    }
    if (method !== 'PUT') throw error(405, '请求方式不支持');
    if (role === 'viewer') throw error(403, '当前账号只有查看权限');
    const data = await readJson(req, MAX_STATE_BYTES);
    const state = validateState(data.state);
    const currentRole = roleFor(id, username);
    if (!['admin', 'editor'].includes(currentRole)) throw error(403, '项目编辑权限已变更');
    const time = new Date().toISOString();
    const result = db.prepare('UPDATE projects SET payload=?, version=version+1, updated_at=?, updated_by=? WHERE id=? AND version=?')
      .run(JSON.stringify(state), time, username, id, Number(data.version) || 0);
    if (!result.changes) throw error(409, '同事已保存新版本。请先备份草稿，再加载最新版核对。');
    return { ...metadata(getProject.get(id), currentRole), state };
  };
  return { adminPasswordFile, authenticate, routes };
}

module.exports = { openSharedStore, readJson };
