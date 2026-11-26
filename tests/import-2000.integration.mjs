import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
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
let workspaceId,batchId,fileId
try {
  const pass=(await readFile(resolve(root,'.local-data/shared-admin.txt'),'utf8')).trim()
  const login=await app.inject({method:'POST',url:'/api/v1/session',payload:{username:'admin',password:pass}})
  const cookie=login.headers['set-cookie'].split(';')[0]
  const features=Array.from({length:2000},(_,index)=>{
    const x=118.70+(index%50)*.00022,y=32.00+Math.floor(index/50)*.00022
    return {type:'Feature',properties:{名称:`负载宗地${index+1}`,编号:index+1},geometry:{type:'Polygon',coordinates:[[[x,y],[x+.00015,y],[x+.00015,y+.00015],[x,y+.00015],[x,y]]]}}
  })
  const boundary='test'+randomUUID(),collection={type:'FeatureCollection',features}
  const payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="2000-parcels.geojson"\r\nContent-Type: application/geo+json\r\n\r\n`),Buffer.from(JSON.stringify(collection)),Buffer.from(`\r\n--${boundary}--\r\n`)])
  const start=performance.now()
  const preview=await app.inject({method:'POST',url:'/api/v1/imports/preview',headers:{cookie,'content-type':`multipart/form-data; boundary=${boundary}`},payload})
  assert.equal(preview.statusCode,200,preview.body.slice(0,300))
  batchId=preview.json().batchId;fileId=preview.json().fileId
  workspaceId=(await db.query('INSERT INTO renewal.workspaces(name) VALUES($1) RETURNING id',['__2000_test_'+randomUUID()])).rows[0].id
  const commit=await app.inject({method:'POST',url:`/api/v1/imports/${batchId}/commit`,headers:{cookie},payload:{workspaceId:String(workspaceId),layers:[{name:'负载宗地',kind:'parcel'}]}})
  assert.equal(commit.statusCode,200,commit.body.slice(0,300))
  assert.equal(commit.json().featureCount,2000)
  const layerId=commit.json().layerIds[0]
  const page=await app.inject({method:'GET',url:`/api/v1/layers/${layerId}/features?limit=100&offset=1900`,headers:{cookie}})
  assert.equal(page.json().total,2000);assert.equal(page.json().features.length,100)
  const map=await app.inject({method:'GET',url:`/api/v1/map/features?bbox=118.69,31.99,118.72,32.02&layerIds=${layerId}`,headers:{cookie}})
  assert.equal(map.statusCode,200);assert.equal(map.json().features.length,1500);assert.equal(map.json().truncated,true)
  console.log(JSON.stringify({passed:true,features:2000,bytes:payload.length,seconds:Math.round((performance.now()-start)/100)/10,mapLimit:1500}))
} finally {
  if(workspaceId) await db.query('DELETE FROM renewal.workspaces WHERE id=$1',[workspaceId]).catch(()=>{})
  if(batchId) await db.query('DELETE FROM renewal.app_import_batches WHERE id=$1',[batchId]).catch(()=>{})
  if(fileId) await db.query('DELETE FROM renewal.app_files WHERE id=$1',[fileId]).catch(()=>{})
  if(batchId) await unlink(resolve(root,'.local-data/import-staging',batchId+'.json')).catch(()=>{})
  if(fileId) await unlink(resolve(root,'.local-data/import-objects',fileId)).catch(()=>{})
  await db.end();await app.close()
}
