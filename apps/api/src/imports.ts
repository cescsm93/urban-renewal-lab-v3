import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { HttpProblem, requireScope } from './auth.js'
import { pool } from './db.js'

const root = resolve(import.meta.dirname, '../../..')
const objectDir = resolve(root, '.local-data/import-objects')
const stagingDir = resolve(root, '.local-data/import-staging')
const maxBytes = 20 * 1024 * 1024
const featureSchema = z.object({ type: z.literal('Feature'), properties: z.record(z.string(), z.unknown()).nullable(), geometry: z.object({type:z.string(),coordinates:z.unknown().optional(),geometries:z.unknown().optional()}) })
const collectionSchema = z.object({type:z.literal('FeatureCollection'),features:z.array(featureSchema).max(5000)})
type Collection = z.infer<typeof collectionSchema>
type Prepared = {name:string,collection:Collection}
const safeName = (name:string) => name.replace(/[\x00-\x1f<>:"/\\|?*]/g,'_').trim().slice(0,120) || '导入图层'

function convertGdb(bytes:Buffer, filename:string):Promise<{layers:Prepared[],sourceCRS:string}> {
  return new Promise((resolveResult,reject)=>{
    const child=spawn('python',[resolve(root,'gis/import_geodatabase.py')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='', errors=''
    const timer=setTimeout(()=>child.kill(),120000)
    child.stdout.on('data',(part:Buffer)=>{output+=part.toString();if(output.length>80*1024*1024) child.kill()})
    child.stderr.on('data',(part:Buffer)=>{errors+=part.toString().slice(0,1000)})
    child.on('error',reject)
    child.on('close',code=>{
      clearTimeout(timer)
      try { const result=JSON.parse(output); if(code || result.error) throw Error(result.error||errors||'GDB 转换失败');resolveResult(result) }
      catch(error){reject(error)}
    })
    child.stdin.end(JSON.stringify({filename,data:bytes.toString('base64')}))
  })
}

function prepareGeojson(bytes:Buffer,filename:string) {
  let raw:unknown
  try {raw=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))} catch {throw new HttpProblem(400,'BAD_GEOJSON','GeoJSON 不是有效 JSON')}
  const parsed=collectionSchema.safeParse(raw)
  if(!parsed.success) throw new HttpProblem(400,'BAD_GEOJSON','请提供最多 5000 条要素的 FeatureCollection')
  const crs=(raw as {crs?:unknown}).crs
  if(crs && !/4326|CRS84/i.test(JSON.stringify(crs))) throw new HttpProblem(400,'CRS_REQUIRED','当前仅接收 WGS84 GeoJSON；其他坐标系请先转换')
  return {layers:[{name:safeName(filename.replace(/\.geojson$/i,'')),collection:parsed.data}],sourceCRS:'EPSG:4326'}
}

const commitInput=z.object({workspaceId:z.string().regex(/^\d+$/),layers:z.array(z.object({name:z.string().trim().min(1).max(120),kind:z.enum(['project','parcel','building','planned_land','other'])})).min(1).max(16)})
export async function registerImports(app:FastifyInstance) {
  await app.register(multipart,{limits:{files:1,fileSize:maxBytes,fields:0}})
  app.get('/api/v1/imports/workspaces',async request=>{
    await requireScope(request,'archive:import')
    const rows=await pool.query('SELECT id,name FROM renewal.workspaces ORDER BY id')
    return {workspaces:rows.rows.map(row=>({id:String(row.id),name:row.name}))}
  })
  app.get('/api/v1/imports',async request=>{
    const who=await requireScope(request,'archive:import')
    const rows=await pool.query(`SELECT b.id,b.file_id,b.status,b.source_crs,b.layer_summaries,b.target_layer_ids,b.created_at,
      f.original_name,f.byte_size FROM renewal.app_import_batches b JOIN renewal.app_files f ON f.id=b.file_id
      WHERE ($1::boolean OR b.uploaded_by=$2) ORDER BY b.created_at DESC LIMIT 30`,[who.admin,who.username])
    return {batches:rows.rows.map(row=>({id:row.id,fileId:row.file_id,status:row.status,sourceCRS:row.source_crs,
      filename:row.original_name,byteSize:Number(row.byte_size),layers:row.layer_summaries,layerIds:(row.target_layer_ids||[]).map(String),createdAt:row.created_at}))}
  })
  app.get<{Params:{id:string}}>('/api/v1/imports/:id/source',async(request,reply)=>{
    await requireScope(request,'source:download')
    if(!/^[0-9a-f-]{36}$/i.test(request.params.id)) throw new HttpProblem(400,'BAD_ID','文件编号无效')
    const row=await pool.query('SELECT original_name,mime_type,sha256 FROM renewal.app_files WHERE id=$1',[request.params.id])
    if(!row.rowCount) throw new HttpProblem(404,'NOT_FOUND','原文件不存在')
    let bytes:Buffer
    try {bytes=await readFile(resolve(objectDir,request.params.id))}
    catch {throw new HttpProblem(410,'SOURCE_MISSING','本机原文件已丢失')}
    if(createHash('sha256').update(bytes).digest('hex')!==row.rows[0].sha256)
      throw new HttpProblem(409,'SOURCE_CHANGED','原文件校验失败')
    reply.header('Content-Type',row.rows[0].mime_type||'application/octet-stream')
    reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.rows[0].original_name)}`)
    return reply.send(bytes)
  })
  app.post('/api/v1/imports/preview',async request=>{
    const who=await requireScope(request,'archive:import')
    const file=await request.file()
    if(!file) throw new HttpProblem(400,'FILE_REQUIRED','请选择 GeoJSON 或 GDB ZIP/RAR')
    const filename=safeName(file.filename)
    if(!/\.(geojson|zip|rar)$/i.test(filename)) throw new HttpProblem(400,'BAD_TYPE','仅支持 .geojson、.zip、.rar')
    const bytes=await file.toBuffer()
    if(!bytes.length || bytes.length>maxBytes) throw new HttpProblem(413,'FILE_SIZE','文件为空或大于 20 MB')
    let prepared:{layers:Prepared[],sourceCRS:string}
    try {prepared=/\.geojson$/i.test(filename)?prepareGeojson(bytes,filename):await convertGdb(bytes,filename)}
    catch(error){if(error instanceof HttpProblem) throw error;throw new HttpProblem(400,'CONVERSION_FAILED',error instanceof Error?error.message:'GDB 转换失败')}
    if(prepared.layers.length>16) throw new HttpProblem(400,'TOO_MANY_LAYERS','单次最多 16 层')
    if(prepared.layers.reduce((sum,layer)=>sum+layer.collection.features.length,0)>10000)
      throw new HttpProblem(400,'TOO_MANY_FEATURES','单次最多导入 10000 条要素，请分批上传')
    for(const layer of prepared.layers) {
      const parsed=collectionSchema.safeParse(layer.collection)
      if(!parsed.success || !parsed.data.features.length) throw new HttpProblem(400,'EMPTY_LAYER',`${layer.name} 为空或格式无效`)
      layer.name=safeName(layer.name)
      layer.collection=parsed.data
    }
    const fileId=randomUUID(),batchId=randomUUID()
    const summaries=prepared.layers.map(layer=>({name:layer.name,count:layer.collection.features.length,
      fields:[...new Set(layer.collection.features.flatMap(item=>Object.keys(item.properties||{})))].slice(0,300)}))
    await mkdir(objectDir,{recursive:true});await mkdir(stagingDir,{recursive:true})
    await writeFile(resolve(objectDir,fileId),bytes,{flag:'wx'})
    await writeFile(resolve(stagingDir,batchId+'.json'),JSON.stringify(prepared),{flag:'wx'})
    await pool.query(`INSERT INTO renewal.app_files(id,original_name,mime_type,byte_size,sha256,uploaded_by)
      VALUES($1,$2,$3,$4,$5,$6)`,[fileId,filename,file.mimetype,bytes.length,createHash('sha256').update(bytes).digest('hex'),who.username])
    await pool.query(`INSERT INTO renewal.app_import_batches(id,file_id,uploaded_by,source_crs,layer_summaries)
      VALUES($1,$2,$3,$4,$5)`,[batchId,fileId,who.username,prepared.sourceCRS,JSON.stringify(summaries)])
    return {batchId,fileId,filename,sourceCRS:prepared.sourceCRS,layers:summaries,storage:'local'}
  })
  app.post<{Params:{id:string}}>('/api/v1/imports/:id/commit',async request=>{
    const who=await requireScope(request,'archive:import')
    const id=request.params.id
    if(!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpProblem(400,'BAD_ID','导入批次无效')
    const input=commitInput.safeParse(request.body)
    if(!input.success) throw new HttpProblem(400,'BAD_INPUT','请选择工作区并确认每层名称与类别')
    const db=await pool.connect()
    try {
      await db.query('BEGIN')
      const row=await db.query('SELECT * FROM renewal.app_import_batches WHERE id=$1 FOR UPDATE',[id])
      if(!row.rowCount) throw new HttpProblem(404,'NOT_FOUND','导入预览不存在')
      const batch=row.rows[0]
      if(batch.status!=='preview') throw new HttpProblem(409,'ALREADY_COMMITTED','这批文件已经导入')
      if(!who.admin && batch.uploaded_by!==who.username) throw new HttpProblem(403,'FORBIDDEN','只能提交自己的导入批次')
      let prepared:{layers:Prepared[],sourceCRS:string}
      try {prepared=JSON.parse(await readFile(resolve(stagingDir,id+'.json'),'utf8'))}
      catch {throw new HttpProblem(410,'PREVIEW_EXPIRED','预览缓存不存在，请重新上传')}
      if(input.data.layers.length!==prepared.layers.length) throw new HttpProblem(400,'LAYER_COUNT','导入层数与预览不符')
      const workspace=await db.query('SELECT id FROM renewal.workspaces WHERE id=$1',[input.data.workspaceId])
      if(!workspace.rowCount) throw new HttpProblem(404,'WORKSPACE_NOT_FOUND','工作区不存在')
      const names=new Set(input.data.layers.map(layer=>layer.name))
      if(names.size!==input.data.layers.length) throw new HttpProblem(400,'DUPLICATE_NAME','本批图层名称不能重复')
      const layerIds:string[]=[]
      for(let i=0;i<prepared.layers.length;i++) {
        const target=input.data.layers[i], source=prepared.layers[i]
        const fields=[...new Set(source.collection.features.flatMap(item=>Object.keys(item.properties||{})))].slice(0,300)
        const inserted=await db.query(`INSERT INTO renewal.layers(workspace_id,name,kind,source_filename,source_crs,registration_note,field_order)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[input.data.workspaceId,target.name,target.kind,batch.file_id,prepared.sourceCRS,
          '上传文件原始坐标精度未独立核验；不用于法定边界或精确测距',fields])
        const layerId=String(inserted.rows[0].id);layerIds.push(layerId)
        for(let j=0;j<source.collection.features.length;j++) {
          const feature=source.collection.features[j]
          await db.query(`INSERT INTO renewal.features(layer_id,source_feature_id,properties,geom,updated_by)
            VALUES($1,$2,$3::jsonb,ST_SetSRID(ST_GeomFromGeoJSON($4),4326),$5)`,
            [layerId,String(j+1),JSON.stringify(feature.properties||{}),JSON.stringify(feature.geometry),who.username])
        }
      }
      await db.query(`UPDATE renewal.app_import_batches SET status='committed',target_layer_ids=$1,committed_at=now() WHERE id=$2`,[layerIds,id])
      await db.query('COMMIT')
      return {batchId:id,status:'committed',layerIds,featureCount:prepared.layers.reduce((n,layer)=>n+layer.collection.features.length,0)}
    } catch(error) {
      await db.query('ROLLBACK')
      if((error as {code?:string}).code==='23505') throw new HttpProblem(409,'DUPLICATE_LAYER','工作区已有同名图层，请修改名称')
      if((error as {code?:string}).code==='23514'||(error as {code?:string}).code==='XX000') throw new HttpProblem(400,'INVALID_GEOMETRY','某个要素边界无效或不在 WGS84 范围，请修正源文件')
      throw error
    } finally {db.release()}
  })
}
