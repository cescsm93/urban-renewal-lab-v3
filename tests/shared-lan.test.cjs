const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renewal-lan-test-'));
const port = 4191;
const base = 'http://127.0.0.1:' + port;
let child;

async function start() {
  child = spawn(process.execPath, ['lan-server.cjs'], {
    cwd: root, env: { ...process.env, PORT: String(port), LAN_HOST: '127.0.0.1', RENEWAL_DATA_DIR: dir },
    windowsHide: true, stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Server startup timed out')), 8000);
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('LAN website:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(Error('Server exited ' + code));
    });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}
async function call(method, route, cookie, body) {
  const headers = cookie ? { Cookie: cookie } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function login(username, password) {
  const result = await call('POST', '/lan-login', null, { username, password });
  assert.equal(result.status, 200);
  return result.cookie;
}
async function run() {
  await start();
  const adminPassword = fs.readFileSync(path.join(dir, 'shared-admin.txt'), 'utf8');
  const guest = await login('', fs.readFileSync(path.join(dir, 'lan-access.txt'), 'utf8'));
  assert.equal((await call('GET', '/api/shared/projects', guest)).status, 403);
  assert.equal((await call('GET', '/api/shared/projects')).status, 401);
  const admin = await login('admin', adminPassword);
  const editorPassword = (await call('POST', '/api/shared/users', admin, { username: 'test-editor' })).data.password;
  const viewerPassword = (await call('POST', '/api/shared/users', admin, { username: 'test-viewer' })).data.password;
  const editor = await login('test-editor', editorPassword);
  const viewer = await login('test-viewer', viewerPassword);
  const state = {
    projects: [{ name: '地块A', pts: [[118,32],[118.1,32],[118,32.1]] }],
    renewalAreas: [], importedReferenceGeoJSON: { type: 'FeatureCollection', features: [] }
  };
  const created = await call('POST', '/api/shared/projects', admin, { name: '测试项目', state });
  assert.equal(created.status, 200);
  const route = '/api/shared/projects/' + created.data.id;
  assert.deepEqual((await call('GET', '/api/shared/projects', editor)).data.projects, []);
  assert.equal((await call('GET', route, editor)).status, 404);
  for (const [username, role] of [['test-editor', 'editor'], ['test-viewer', 'viewer']]) {
    assert.equal((await call('PUT', route + '/members', admin, { username, role })).status, 200);
  }
  assert.equal((await call('GET', route, viewer)).data.role, 'viewer');
  assert.equal((await call('PUT', route, viewer, { version: 1, state })).status, 403);
  assert.equal((await call('PUT', route + '/members', editor, { username: 'test-viewer', role: 'editor' })).status, 403);
  state.projects[0].name = '共享修改';
  const saves = await Promise.all([
    call('PUT', route, editor, { version: 1, state }),
    call('PUT', route, admin, { version: 1, state })
  ]);
  assert.deepEqual(saves.map(result => result.status).sort(), [200, 409]);
  assert.equal((await call('GET', route, viewer)).data.state.projects[0].name, '共享修改');
  assert.equal((await call('GET', route + '?version=2', viewer)).data.state, undefined);
  await call('PUT', route + '/members', admin, { username: 'test-editor', role: 'none' });
  assert.equal((await call('GET', route, editor)).status, 404);
  await call('POST', '/api/shared/users', admin, { username: 'test-viewer', reset: true });
  assert.equal((await call('GET', route, viewer)).status, 401);
  await stop();
  await start();
  const reopened = await login('admin', adminPassword);
  assert.equal((await call('GET', route, reopened)).data.version, 2);
  console.log('PASS shared LAN guest isolation, membership, read-only role, concurrent save, revocation, password reset and restart persistence');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(stop);
