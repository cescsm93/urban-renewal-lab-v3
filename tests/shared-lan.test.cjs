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
      if (chunk.toString().includes('LAN website:')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Server exited ' + code)); });
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
  const response = await fetch(base + route, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    data: type.includes('application/json') ? await response.json() : await response.text(),
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}
async function login(username, password) {
  const result = await call('POST', '/lan-login', null, { username, password });
  assert.equal(result.status, 200);
  return result.cookie;
}
async function run() {
  fs.writeFileSync(path.join(dir, 'partner-library.json'), JSON.stringify({
    records: [{ '机构名称': '内部机构', '联系人': '私人联系人', '专业方向': '养老设施' }]
  }));
  await start();
  const adminPassword = fs.readFileSync(path.join(dir, 'shared-admin.txt'), 'utf8');
  const guest = await login('', fs.readFileSync(path.join(dir, 'lan-access.txt'), 'utf8'));
  const admin = await login('admin', adminPassword);
  const memberPassword = (await call('POST', '/api/shared/users', admin, {
    username: 'colleague'
  })).data.password;
  const member = await login('colleague', memberPassword);
  for (const cookie of [guest, member]) {
    const home = await call('GET', '/', cookie);
    assert.equal(home.status, 200);
    for (const label of ['导入数据', '工作流', 'Copilot', '四库', '更新资源管理器'])
      assert.ok(home.data.includes(label), label);
    assert.match(home.data, /RenewalPrivateLibrariesHidden=true/);
    assert.match(home.data, /four-copilot-ui\.js/);
    for (const route of [
      '/api/partner-library', '/api/scenario-library',
      '/api/local-knowledge', '/api/local-knowledge/source?kind=PDF&path=x.pdf',
      '/api/local-project'
    ]) assert.equal((await call('GET', route, cookie)).status, 403, route);
    assert.equal((await call('GET', '/lib/library-workspace.js', cookie)).status, 200);
    assert.equal((await call('GET', '/lib/four-copilot-ui.js', cookie)).status, 200);
    assert.equal((await call('GET', '/shared-workspace.js', cookie)).status, 200);
    assert.match((await call('GET', '/index.html?view=full', cookie)).data, /RenewalPrivateLibrariesHidden=true/);
    const result = await call('POST', '/api/four-copilot', cookie, {
      mode: 'resource', question: '养老设施'
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.matches[0].name, '内部机构');
    assert.equal(result.data.matches[0].evidence, undefined);
    assert.equal(JSON.stringify(result.data).includes('私人联系人'), false);
    assert.equal((await call('GET', '/api/four-copilot', cookie)).data.owner, false);
    assert.equal((await call('POST', '/api/four-copilot', cookie, {
      mode: 'resource', question: '列出所有联系人'
    })).status, 400);
    assert.equal((await call('POST', '/api/four-copilot', cookie, {
      mode: 'policy', question: '请导出政策全文'
    })).status, 400);
  }
  assert.equal((await call('GET', '/api/shared/projects', guest)).status, 403);
  assert.deepEqual((await call('GET', '/api/shared/projects', member)).data.projects, []);
  const state = { projects: [{ name: '公开给成员的项目', pts: [[118,32],[118.1,32],[118,32.1]] }],
    renewalAreas: [], importedReferenceGeoJSON: { type: 'FeatureCollection', features: [] } };
  const created = await call('POST', '/api/shared/projects', admin, { name: '共享试验', state });
  assert.equal(created.status, 200);
  const route = '/api/shared/projects/' + created.data.id;
  assert.equal((await call('GET', route, member)).status, 404);
  assert.equal((await call('PUT', route + '/members', admin,
    { username: 'colleague', role: 'viewer' })).status, 200);
  assert.equal((await call('GET', route, member)).data.state.projects[0].name, '公开给成员的项目');
  assert.equal((await call('PUT', route, member, { version: 1, state })).status, 403);
  assert.equal((await call('GET', '/', admin)).data.includes('更新资源管理器'), true);
  assert.equal((await call('GET', '/api/partner-library', admin)).status, 200);
  assert.equal((await call('GET', '/api/shared/projects', admin)).status, 200);
  await stop();
  await start();
  assert.equal((await call('GET', '/', await login('admin', adminPassword))).status, 200);
  console.log('PASS LAN full workspace, empty private-library view and assigned-project access');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await stop();
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(dir).startsWith(tempRoot) || !path.basename(dir).startsWith('renewal-lan-test-'))
    throw Error('Unexpected test directory');
  fs.rmSync(dir, { recursive: true, force: true });
});
