import type { FastifyInstance } from 'fastify'
import { readFile,stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { HttpProblem, requireScope } from './auth.js'
import { pool } from './db.js'

const input=z.object({layerId:z.string().regex(/^\d+$/),featureId:z.string().regex(/^\d+$/),radiusMeters:z.number().int().min(500).max(5000).default(2000)})
const id=(value:string)=>{if(!/^\d+$/.test(value)) throw new HttpProblem(400,'BAD_ID','编号无效');return value}
const root=resolve(import.meta.dirname,'../../..')
const execFileAsync=promisify(execFile)
let activeStudy=0
type LocalWindow={cells?:[number,number,number][],missing?:number,gridCount?:number,workers?:number|null,workCells?:[number,number,number][],homes?:[number,number,number,string][],poiSummary?:Record<string,{count:number,nearest:{name:string,address:string,point:[number,number],meters:number}[],unmarked?:{name:string,address:string,meters:number}}>}
async function localWindow(lon:number,lat:number,radius:number) {
  if(activeStudy>=3) return {available:false,radiusMeters:radius,reason:'专题分析繁忙，请稍后重试'}
  activeStudy++
  try {
    const config=JSON.parse(await readFile(resolve(root,'.local-data/population.json'),'utf8')) as {python:string,raster:string}
    await stat(config.raster)
    const {stdout}=await execFileAsync(config.python,[resolve(root,'gis/population_window.py'),config.raster,String(lon),String(lat),String(radius)],
      {windowsHide:true,timeout:20000,maxBuffer:8*1024*1024})
    const data=JSON.parse(stdout) as LocalWindow
    const housing=new Map<string,{name:string,values:number[],point:[number,number]}>()
    for(const [x,y,price,name] of data.homes||[]) {
      if(!Number.isFinite(price)||price<=0) continue
      const key=String(name||'未命名小区'),item=housing.get(key)||{name:key,values:[],point:[x,y] as [number,number]}
      item.values.push(price);housing.set(key,item)
    }
    const homes=[...housing.values()].map(item=>({name:item.name,meanPrice:Math.round(item.values.reduce((a,b)=>a+b,0)/item.values.length),samples:item.values.length,point:item.point})).sort((a,b)=>b.meanPrice-a.meanPrice).slice(0,30)
    const cells=data.cells||[]
    const poi=Object.entries(data.poiSummary||{}).map(([category,value])=>({category,count:value.count,nearest:value.nearest})).sort((a,b)=>b.count-a.count)
    return {available:true,radiusMeters:radius,center:[lon,lat],
      population:{source:data.gridCount?'本机人口格网':'WorldPop R2025A v1 · 约100米格网',
        cells:cells.length,estimatedResidents:Math.round(cells.reduce((sum,row)=>sum+row[2],0)),
        missingCells:data.missing||0,workers:data.workers??null,
        heatCells:cells.length>1200?cells.filter((_,index)=>index%Math.ceil(cells.length/1200)===0):cells},
      housing:{source:'本机历史住宅样本，采价日期请核对原始数据',communities:homes,totalSamples:(data.homes||[]).length},
      poi:{source:'本机 POI 档案，站点运营状态需核实',categories:poi}}
  } catch {return {available:false,radiusMeters:radius,reason:'本机专题数据不可用或处理超时'}
  } finally {activeStudy--}
}
type Relation={layerId:string,layerName:string,kind:string,featureId:string,name:string,relation:string,overlapSqm:number|null}
const nameOf=(properties:Record<string,unknown>)=>String(properties['项目名称']||properties['宗地名称']||properties['建筑名称']||properties['名称']||properties['规划用地性质']||properties['用地性质']||'未命名')

export function registerWorkflow(app:FastifyInstance) {
  app.get('/api/v1/workflow/subjects',async request=>{
    await requireScope(request,'archive:view')
    const rows=await pool.query(`SELECT f.id,f.layer_id,f.properties,l.name AS layer_name
      FROM renewal.features f JOIN renewal.layers l ON l.id=f.layer_id
      WHERE l.kind='project' ORDER BY l.id,f.id LIMIT 1000`)
    return {subjects:rows.rows.map(row=>({layerId:String(row.layer_id),featureId:String(row.id),name:nameOf(row.properties),layerName:row.layer_name}))}
  })
  app.post('/api/v1/workflow/runs',async request=>{
    await requireScope(request,'archive:view')
    const parsed=input.safeParse(request.body)
    if(!parsed.success) throw new HttpProblem(400,'BAD_INPUT','请选择有效项目')
    const subject=(await pool.query(`SELECT f.id,f.layer_id,f.properties,ST_AsGeoJSON(f.geom,15)::json AS geometry,
      ST_X(ST_PointOnSurface(f.geom))::float AS lon,ST_Y(ST_PointOnSurface(f.geom))::float AS lat,
      l.workspace_id,l.name AS layer_name,l.registration_note
      FROM renewal.features f JOIN renewal.layers l ON l.id=f.layer_id
      WHERE f.id=$1 AND f.layer_id=$2 AND l.kind='project'`,[parsed.data.featureId,parsed.data.layerId])).rows[0]
    if(!subject) throw new HttpProblem(404,'PROJECT_NOT_FOUND','项目图斑不存在')
    const rows=await pool.query(`SELECT f.id,f.layer_id,f.properties,l.name AS layer_name,l.kind,
      CASE WHEN ST_Touches(s.geom,f.geom) THEN '边界接触'
        WHEN ST_Covers(s.geom,f.geom) THEN '项目覆盖该图斑'
        WHEN ST_Covers(f.geom,s.geom) THEN '该图斑覆盖项目'
        ELSE '边界相交' END AS relation,
      CASE WHEN ST_Dimension(f.geom)=2 AND ST_Dimension(s.geom)=2
        THEN round(ST_Area(ST_Intersection(f.geom,s.geom)::geography)::numeric,1)::float
        ELSE NULL END AS overlap_sqm
      FROM renewal.features s JOIN renewal.layers sl ON sl.id=s.layer_id
      JOIN renewal.features f ON f.id<>s.id
      JOIN renewal.layers l ON l.id=f.layer_id AND l.workspace_id=sl.workspace_id
      WHERE s.id=$1 AND s.layer_id=$2 AND l.kind IN ('parcel','building','planned_land')
        AND f.geom && s.geom AND ST_Intersects(f.geom,s.geom)
      ORDER BY l.kind,f.id LIMIT 5000`,[subject.id,subject.layer_id])
    const related:Relation[]=rows.rows.map(row=>({layerId:String(row.layer_id),layerName:row.layer_name,
      kind:row.kind,featureId:String(row.id),name:nameOf(row.properties),relation:row.relation,
      overlapSqm:row.overlap_sqm}))
    const counts=Object.fromEntries(['parcel','building','planned_land'].map(kind=>[kind,related.filter(row=>row.kind===kind && row.relation!=='边界接触' && (row.overlapSqm===null || row.overlapSqm>=1)).length]))
    const properties=subject.properties as Record<string,unknown>
    const study=await localWindow(subject.lon,subject.lat,parsed.data.radiusMeters)
    const missing=['商业租金','公服步行覆盖'].map(item=>`${item}尚未接入本轮研判`)
    if(!study.available) missing.push('本机人口、房价与 POI 数据未能读取')
    else {
      if(!study.population?.cells) missing.push('研究圈内缺少人口格网样本')
      if(!study.housing?.totalSamples) missing.push('研究圈内缺少住宅价格样本')
      if(!study.poi?.categories.length) missing.push('研究圈内缺少 POI 记录')
    }
    const result={subject:{layerId:String(subject.layer_id),featureId:String(subject.id),name:nameOf(properties),
      layerName:subject.layer_name,properties,geometry:subject.geometry},
      counts,relations:related,truncated:rows.rows.length===5000,study,algorithmVersion:'preliminary-v2',
      precision:{status:/示意|配准|近似/.test(subject.registration_note||'')?'approximate':'unknown',note:subject.registration_note||'原始坐标精度未核验'},
      findings:[`项目档案记录的更新方式：${String(properties['更新方式']||'未录入')}。`,`空间叠加：有效重叠宗地 ${counts.parcel} 条、建筑 ${counts.building} 条、规划用地 ${counts.planned_land} 条；边界接触与不足 1 平方米的相交仅列在明细中。`],
      recommendation:'结合档案更新方式、规划用途及周边专题样本筛选改造方向；房价为历史样本，人口为估算值，POI 运营状态待核实。业态适配与财务可行性仍须现场调研和正式测算。',
      dataGaps:missing,algorithm:'PostGIS ST_Intersects 空间叠加；面积仅供示意核对，不作为法定界线或精确测距。',createdAt:new Date().toISOString()}
    const saved=await pool.query(`INSERT INTO renewal.analysis_runs(workspace_id,subject_feature_id,tool_name,inputs,results)
      VALUES($1,$2,'preliminary-study',$3,$4) RETURNING id,created_at`,
      [subject.workspace_id,subject.id,JSON.stringify(parsed.data),JSON.stringify(result)])
    return {...result,id:String(saved.rows[0].id),createdAt:saved.rows[0].created_at}
  })
  app.get('/api/v1/workflow/runs',async request=>{
    await requireScope(request,'report:view')
    const rows=await pool.query(`SELECT id,created_at,results->'subject'->>'name' AS name FROM renewal.analysis_runs
      WHERE tool_name='preliminary-study' ORDER BY id DESC LIMIT 100`)
    return {runs:rows.rows.map(row=>({id:String(row.id),name:row.name,createdAt:row.created_at}))}
  })
  app.get<{Params:{id:string}}>('/api/v1/workflow/runs/:id',async request=>{
    await requireScope(request,'report:view')
    const rows=await pool.query(`SELECT id,created_at,results FROM renewal.analysis_runs
      WHERE id=$1 AND tool_name='preliminary-study'`,[id(request.params.id)])
    if(!rows.rowCount) throw new HttpProblem(404,'NOT_FOUND','研判记录不存在')
    return {id:String(rows.rows[0].id),createdAt:rows.rows[0].created_at,...rows.rows[0].results}
  })
}
