const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { randomBytes, scryptSync } = require('node:crypto');
const { connection } = require('../lib/postgis-db.cjs');

function request(path, method = 'GET', body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: 4190, path, method, headers: {
      ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      ...(cookie ? { cookie } : {})
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, data: JSON.parse(raw), cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }); }
        catch { reject(Error(`Non-JSON response: ${res.statusCode}`)); }
      });
    });
    req.on('error', reject);
    req.end(payload || undefined);
  });
}

async function main() {
  const db = await connection().connect();
  const username = `test_${randomBytes(5).toString('hex')}`;
  const password = randomBytes(18).toString('hex');
  const salt = randomBytes(16).toString('hex');
  let testProject;
  let testWorkspace;
  let testLayer;
  try {
    const original = await db.query('SELECT id FROM renewal.app_projects ORDER BY id LIMIT 1');
    assert.ok(original.rowCount, 'Migrated project missing');
    const projectId = String(original.rows[0].id);
    await db.query('INSERT INTO renewal.app_users(username,salt,password_hash) VALUES($1,$2,$3)',
      [username,salt,scryptSync(password,salt,32).toString('hex')]);
    await db.query('INSERT INTO renewal.app_project_members(project_id,username,role) VALUES($1,$2,$3)',
      [projectId,username,'viewer']);
    testWorkspace = (await db.query('INSERT INTO renewal.workspaces(name) VALUES($1) RETURNING id',
      [`__api_test_${randomBytes(5).toString('hex')}`])).rows[0].id;
    testLayer = (await db.query(`INSERT INTO renewal.layers(workspace_id,name,kind,field_order)
      VALUES($1,'临时第五层','other',ARRAY['名称']::text[]) RETURNING id`,[testWorkspace])).rows[0].id;
    assert.equal((await request('/api/v1/projects')).status, 401);
    const login = await request('/api/v1/session','POST',{username,password});
    assert.equal(login.status, 200);
    const staff = login.cookie;
    assert.ok(staff);
    const me = await request('/api/v1/me','GET',undefined,staff);
    assert.equal(me.data.admin,false);
    assert.equal(me.data.scopes.includes('source:preview'),false);
    assert.equal((await request('/api/v1/projects','GET',undefined,staff)).data.projects.length,1);
    assert.equal((await request('/api/v1/layers','GET',undefined,staff)).status,200);
    assert.ok((await request('/api/v1/layers','GET',undefined,staff)).data.layers.some(layer => layer.layerId === String(testLayer)));
    assert.equal((await request('/api/v1/knowledge/catalog','GET',undefined,staff)).status,403);
    assert.equal((await request('/api/v1/knowledge/source?kind=PDF&path=guess.pdf','GET',undefined,staff)).status,403);
    const answer = await request('/api/v1/knowledge/query','POST',{question:'南京市城市更新政策依据有哪些？'},staff);
    assert.equal(answer.status,200);
    assert.ok(answer.data.sources.length > 0);
    assert.ok(answer.data.sources.every(source => !source.path && !source.openUrl));
    assert.equal((await request(`/api/v1/projects/${projectId}`,'PUT',{
      expectedVersion:1,draftRevision:0,state:{} },staff)).status,403);
    const layers = await request('/api/v1/layers','GET',undefined,staff);
    const layerId = layers.data.layers[0].layerId;
    assert.equal((await request(`/api/v1/layers/${layerId}/features`,'POST',{
      properties:{},geometry:{type:'Point',coordinates:[118,32]} },staff)).status,403);
    assert.equal((await request('/api/v1/session','DELETE',undefined,staff)).status,200);
    assert.equal((await request('/api/v1/me','GET',undefined,staff)).status,401);

    const adminPassword = fs.readFileSync('.local-data/shared-admin.txt','utf8').trim();
    const adminLogin = await request('/api/v1/session','POST',{username:'admin',password:adminPassword});
    assert.equal(adminLogin.status,200);
    const admin = adminLogin.cookie;
    const created = await request('/api/v1/projects','POST',{name:'API 回归临时项目',state:{projectSummary:'初版'}},admin);
    assert.equal(created.status,201);
    testProject = created.data.id;
    const updated = await request(`/api/v1/projects/${testProject}`,'PUT',{
      expectedVersion:created.data.version,draftRevision:1,state:{projectSummary:'第二版'} },admin);
    assert.equal(updated.status,200);
    assert.equal(updated.data.version,created.data.version+1);
    assert.equal(updated.data.savedDraftRevision,1);
    assert.equal((await request(`/api/v1/projects/${testProject}`,'GET',undefined,admin)).data.state.projectSummary,'第二版');
    assert.equal((await request(`/api/v1/projects/${testProject}`,'PUT',{
      expectedVersion:created.data.version,draftRevision:2,state:{projectSummary:'过期写入'} },admin)).status,409);
    const createdFeature = await request(`/api/v1/layers/${testLayer}/features`,'POST',{
      properties:{名称:'测试点'},geometry:{type:'Point',coordinates:[118.7,32]} },admin);
    assert.equal(createdFeature.status,201);
    const featureId = createdFeature.data.featureId;
    const updatedFeature = await request(`/api/v1/layers/${testLayer}/features/${featureId}`,'PATCH',{
      expectedVersion:createdFeature.data.version,properties:{名称:'已修改'},
      geometry:{type:'Point',coordinates:[118.701,32]} },admin);
    assert.equal(updatedFeature.status,200);
    assert.equal(updatedFeature.data.version,createdFeature.data.version+1);
    assert.equal((await request(`/api/v1/layers/${testLayer}/features`,'GET',undefined,admin)).data.features[0].properties['名称'],'已修改');
    assert.equal((await request(`/api/v1/layers/${testLayer}/features/${featureId}`,'PATCH',{
      expectedVersion:createdFeature.data.version,properties:{名称:'过期'},
      geometry:{type:'Point',coordinates:[118.7,32]} },admin)).status,409);
    console.log('PASS: login, project/feature save-refresh-409, dynamic layer, policy QA, source/edit denial, logout');
  } finally {
    if (testProject) await db.query('DELETE FROM renewal.app_projects WHERE id=$1',[testProject]);
    if (testWorkspace) await db.query('DELETE FROM renewal.workspaces WHERE id=$1',[testWorkspace]);
    await db.query('DELETE FROM renewal.app_users WHERE username=$1',[username]);
    db.release();
    await connection().end();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
