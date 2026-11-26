import assert from 'node:assert/strict'
import {randomUUID,randomBytes,scryptSync} from 'node:crypto'
import {readFile,unlink} from 'node:fs/promises'
import {resolve} from 'node:path'
import pg from 'pg'

process.env.NODE_ENV='test'
const root=resolve(import.meta.dirname,'..')
const env=Object.fromEntries((await readFile(resolve(root,'.local-data/postgis.env'),'utf8')).split(/\r?\n/)
  .filter(line=>line.includes('=')).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)]}))
const db=new pg.Client({host:'127.0.0.1',port:5432,database:env.POSTGRES_DB,user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD})
const {app}=await import('../apps/api/dist/server.js')
await app.ready();await db.connect()
let workspaceId,runId,fileId,batchId,staffName
try {
  const pass=(await readFile(resolve(root,'.local-data/shared-admin.txt'),'utf8')).trim()
  const login=await app.inject({method:'POST',url:'/api/v1/session',payload:{username:'admin',password:pass}})
  assert.equal(login.statusCode,200,login.body)
  const cookie=login.headers['set-cookie'].split(';')[0]
  const polygon={type:'Polygon',coordinates:[[[118.80,32.10],[118.801,32.10],[118.801,32.101],[118.80,32.101],[118.80,32.10]]]}
  const collection={type:'FeatureCollection',features:[{type:'Feature',properties:{项目名称:'临时导入核验'},geometry:polygon}]}
  const boundary='test'+randomUUID()
  const multipart=Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pilot.geojson"\r\nContent-Type: application/geo+json\r\n\r\n`),
    Buffer.from(JSON.stringify(collection)),Buffer.from(`\r\n--${boundary}--\r\n`)])
  const preview=await app.inject({method:'POST',url:'/api/v1/imports/preview',headers:{cookie,'content-type':`multipart/form-data; boundary=${boundary}`},payload:multipart})
  assert.equal(preview.statusCode,200,preview.body)
  const info=preview.json();fileId=info.fileId;batchId=info.batchId
  assert.equal(info.layers[0].count,1)
  const source=await app.inject({method:'GET',url:'/api/v1/imports/'+fileId+'/source',headers:{cookie}})
  assert.equal(source.statusCode,200)
  assert.deepEqual(JSON.parse(source.body),collection)
  staffName='import_test_'+randomBytes(5).toString('hex')
  const staffPass=randomBytes(18).toString('hex'),salt=randomBytes(16).toString('hex')
  await db.query('INSERT INTO renewal.app_users(username,salt,password_hash) VALUES($1,$2,$3)',
    [staffName,salt,scryptSync(staffPass,salt,32).toString('hex')])
  const staffLogin=await app.inject({method:'POST',url:'/api/v1/session',payload:{username:staffName,password:staffPass}})
  const staffCookie=staffLogin.headers['set-cookie'].split(';')[0]
  assert.equal((await app.inject({method:'GET',url:'/api/v1/imports/workspaces',headers:{cookie:staffCookie}})).statusCode,403)
  assert.equal((await app.inject({method:'GET',url:'/api/v1/imports',headers:{cookie:staffCookie}})).statusCode,403)
  assert.equal((await app.inject({method:'GET',url:'/api/v1/imports/'+fileId+'/source',headers:{cookie:staffCookie}})).statusCode,403)
  assert.equal((await app.inject({method:'POST',url:'/api/v1/imports/'+batchId+'/commit',payload:{workspaceId:'1',layers:[{name:'临时核验',kind:'project'}]}})).statusCode,401)
  workspaceId=(await db.query('INSERT INTO renewal.workspaces(name) VALUES($1) RETURNING id',['__test_'+randomUUID()])).rows[0].id
  const commit=await app.inject({method:'POST',url:'/api/v1/imports/'+batchId+'/commit',headers:{cookie},payload:{workspaceId:String(workspaceId),layers:[{name:'临时核验项目',kind:'project'}]}})
  assert.equal(commit.statusCode,200,commit.body)
  const layerId=commit.json().layerIds[0]
  const history=await app.inject({method:'GET',url:'/api/v1/imports',headers:{cookie}})
  assert.equal(history.statusCode,200)
  assert.ok(history.json().batches.some(row=>row.id===batchId&&row.status==='committed'))
  assert.equal((await app.inject({method:'POST',url:'/api/v1/imports/'+batchId+'/commit',headers:{cookie},payload:{workspaceId:String(workspaceId),layers:[{name:'临时核验项目',kind:'project'}]}})).statusCode,409)
  const features=await app.inject({method:'GET',url:`/api/v1/layers/${layerId}/features`,headers:{cookie}})
  assert.equal(features.json().total,1)
  const featureId=features.json().features[0].featureId
  const parcelLayer=(await db.query(`INSERT INTO renewal.layers(workspace_id,name,kind,field_order)
    VALUES($1,'临时宗地','parcel',ARRAY['名称']) RETURNING id`,[workspaceId])).rows[0].id
  await db.query(`INSERT INTO renewal.features(layer_id,properties,geom) VALUES($1,$2,ST_SetSRID(ST_GeomFromGeoJSON($3),4326))`,[parcelLayer,JSON.stringify({名称:'交叉宗地'}),JSON.stringify(polygon)])
  const run=await app.inject({method:'POST',url:'/api/v1/workflow/runs',headers:{cookie},payload:{layerId,featureId}})
  assert.equal(run.statusCode,200,run.body)
  runId=run.json().id
  assert.equal(run.json().counts.parcel,1)
  const report=await app.inject({method:'GET',url:'/api/v1/workflow/runs/'+runId,headers:{cookie}})
  assert.equal(report.statusCode,200)
  assert.equal(report.json().subject.name,'临时导入核验')
  assert.equal(report.json().relations[0].name,'交叉宗地')
  console.log('PASS: upload preview → import → refresh → workflow → saved report; unauthorized/repeat requests rejected')
} finally {
  if(runId) await db.query('DELETE FROM renewal.analysis_runs WHERE id=$1',[runId]).catch(()=>{})
  if(workspaceId) await db.query('DELETE FROM renewal.workspaces WHERE id=$1',[workspaceId]).catch(()=>{})
  if(batchId) await db.query('DELETE FROM renewal.app_import_batches WHERE id=$1',[batchId]).catch(()=>{})
  if(fileId) await db.query('DELETE FROM renewal.app_files WHERE id=$1',[fileId]).catch(()=>{})
  if(staffName) await db.query('DELETE FROM renewal.app_users WHERE username=$1',[staffName]).catch(()=>{})
  if(batchId) await unlink(resolve(root,'.local-data/import-staging',batchId+'.json')).catch(()=>{})
  if(fileId) await unlink(resolve(root,'.local-data/import-objects',fileId)).catch(()=>{})
  await db.end();await app.close()
}
