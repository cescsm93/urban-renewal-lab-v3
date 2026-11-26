import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HttpProblem, requireScope } from './auth.js'
import { pool } from './db.js'

const numberId = (text: string) => {
  if (!/^\d+$/.test(text)) throw new HttpProblem(400, 'BAD_ID', '记录编号无效')
  return text
}
const geometry = z.object({ type: z.string(), coordinates: z.unknown().optional(), geometries: z.unknown().optional() })
const properties = z.record(z.string(), z.unknown())
const editInput = z.object({ expectedVersion: z.number().int().positive(), properties, geometry })
const createInput = z.object({ properties, geometry })
const precisionOf = (row: Record<string, unknown>) => {
  const note = String(row.registration_note || '')
  return { status: /示意|配准|近似|纠偏/.test(note) ? 'approximate' : 'unknown',
    sourceCrs: row.source_crs || null, registrationMethod: note || null,
    errorMeters: null, verifiedAt: null, note: note || null }
}
const layerMeta = (row: Record<string, unknown>) => ({
  layerId: String(row.id), name: row.name, kind: row.kind || 'other',
  sourceId: row.source_filename || null, schemaId: null, schemaVersion: 1,
  geometryType: row.geometry_type || 'mixed', fieldIds: row.field_order || [],
  precision: precisionOf(row), featureCount: Number(row.feature_count || 0)
})
const featureJson = (row: Record<string, unknown>) => ({
  type: 'Feature', layerId: String(row.layer_id), featureId: String(row.id),
  version: row.version, properties: row.properties, geometry: row.geometry
})

async function checkPointLayer(layerId: string, geometryType: string) {
  if (geometryType === 'Point') return
  const result = await pool.query('SELECT 1 FROM renewal.project_layer_sources WHERE layer_id=$1', [layerId])
  if (result.rowCount) throw new HttpProblem(400, 'POINT_LAYER_REQUIRED', '此图层只接受点几何')
}

export function registerArchive(app: FastifyInstance) {
  app.get<{ Querystring: { bbox?: string, layerIds?: string } }>('/api/v1/map/features', async request => {
    await requireScope(request, 'archive:view')
    const bbox = String(request.query.bbox || '').split(',').map(Number)
    if (bbox.length !== 4 || bbox.some(n => !Number.isFinite(n)) ||
      bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 ||
      bbox[0] >= bbox[2] || bbox[1] >= bbox[3])
      throw new HttpProblem(400, 'BAD_BBOX', '地图范围无效')
    const raw = String(request.query.layerIds || '')
    const layerIds = raw ? raw.split(',').map(numberId) : null
    if (layerIds && (layerIds.length < 1 || layerIds.length > 50))
      throw new HttpProblem(400, 'BAD_LAYERS', '图层选择无效')
    const max = layerIds?.length === 1 ? 5000 : 1500
    const result = await pool.query(`SELECT f.id,f.layer_id,f.version,f.properties,
      ST_AsGeoJSON(f.geom,15)::json AS geometry,l.name AS layer_name,l.kind AS layer_kind
      FROM renewal.features f JOIN renewal.layers l ON l.id=f.layer_id
      WHERE ST_Intersects(f.geom,ST_MakeEnvelope($1,$2,$3,$4,4326))
        AND ($5::bigint[] IS NULL OR f.layer_id=ANY($5::bigint[]))
      ORDER BY CASE WHEN l.kind='project' THEN 0 ELSE 1 END,f.id LIMIT $6`,
      [...bbox,layerIds,max+1])
    return { bbox, limit: max, truncated: result.rows.length > max,
      features: result.rows.slice(0,max).map(row => ({ ...featureJson(row),
        layerName: row.layer_name, layerKind: row.layer_kind })) }
  })
  app.get('/api/v1/layers', async request => {
    await requireScope(request, 'archive:view')
    const result = await pool.query(`SELECT l.id,l.name,l.kind,l.source_filename,l.source_crs,
      l.registration_note,l.field_order,count(f.id)::int AS feature_count,
      CASE WHEN count(DISTINCT ST_GeometryType(f.geom))=1
        THEN replace(min(ST_GeometryType(f.geom)),'ST_','') ELSE 'mixed' END AS geometry_type
      FROM renewal.layers l LEFT JOIN renewal.features f ON f.layer_id=l.id
      GROUP BY l.id ORDER BY l.id`)
    return { layers: result.rows.map(layerMeta) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/layers/:id/extent', async request => {
    const id = numberId(request.params.id)
    await requireScope(request, 'archive:view', 'layer', id)
    const result = await pool.query(`SELECT
      CASE WHEN extent IS NOT NULL THEN ARRAY[ST_XMin(extent), ST_YMin(extent),
        ST_XMax(extent), ST_YMax(extent)] END AS bbox
      FROM (SELECT ST_Extent(f.geom) FILTER (WHERE NOT ST_IsEmpty(f.geom)) AS extent
        FROM renewal.layers l LEFT JOIN renewal.features f ON f.layer_id=l.id
        WHERE l.id=$1 GROUP BY l.id) layer`, [id])
    if (!result.rowCount) throw new HttpProblem(404, 'NOT_FOUND', '图层不存在')
    return { layerId: id, bbox: result.rows[0].bbox }
  })
  app.get<{ Params: { id: string }, Querystring: { limit?: string, offset?: string } }>('/api/v1/layers/:id/features', async request => {
    const id = numberId(request.params.id)
    await requireScope(request, 'archive:view', 'layer', id)
    const limit = Number(request.query.limit || 100)
    const offset = Number(request.query.offset || 0)
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0)
      throw new HttpProblem(400, 'BAD_PAGE', '分页参数无效')
    const exists = await pool.query('SELECT id FROM renewal.layers WHERE id=$1', [id])
    if (!exists.rowCount) throw new HttpProblem(404, 'NOT_FOUND', '图层不存在')
    const result = await pool.query(`SELECT id,layer_id,version,properties,ST_AsGeoJSON(geom,15)::json AS geometry
      FROM renewal.features WHERE layer_id=$1 ORDER BY id LIMIT $2 OFFSET $3`, [id,limit,offset])
    const total = await pool.query('SELECT count(*)::int AS n FROM renewal.features WHERE layer_id=$1', [id])
    return { layerId: id, total: total.rows[0].n, offset, features: result.rows.map(featureJson) }
  })
  app.get<{ Params: { id: string, featureId: string } }>('/api/v1/layers/:id/features/:featureId', async request => {
    const id = numberId(request.params.id), featureId = numberId(request.params.featureId)
    await requireScope(request, 'archive:view', 'layer', id)
    const result = await pool.query(`SELECT f.id,f.layer_id,f.version,f.properties,
      ST_AsGeoJSON(f.geom,15)::json AS geometry,l.name AS layer_name,l.kind AS layer_kind
      FROM renewal.features f JOIN renewal.layers l ON l.id=f.layer_id
      WHERE f.layer_id=$1 AND f.id=$2`,[id,featureId])
    if (!result.rowCount) throw new HttpProblem(404,'NOT_FOUND','档案不存在')
    const row = result.rows[0]
    return { ...featureJson(row),layerName:row.layer_name,layerKind:row.layer_kind }
  })
  app.patch<{ Params: { id: string, featureId: string } }>('/api/v1/layers/:id/features/:featureId', async request => {
    const id = numberId(request.params.id)
    const featureId = numberId(request.params.featureId)
    const who = await requireScope(request, 'archive:edit', 'layer', id)
    const input = editInput.safeParse(request.body)
    if (!input.success) throw new HttpProblem(400, 'BAD_INPUT', '字段、几何或版本格式无效')
    await checkPointLayer(id, input.data.geometry.type)
    const result = await pool.query(`UPDATE renewal.features SET properties=$1::jsonb,
      geom=ST_SetSRID(ST_GeomFromGeoJSON($2),4326),version=version+1,
      updated_at=now(),updated_by=$3 WHERE id=$4 AND layer_id=$5 AND version=$6
      RETURNING id,layer_id,version,properties,ST_AsGeoJSON(geom,15)::json AS geometry`,
      [JSON.stringify(input.data.properties),JSON.stringify(input.data.geometry),who.username,featureId,id,input.data.expectedVersion])
    if (!result.rowCount) {
      const found = await pool.query('SELECT version FROM renewal.features WHERE id=$1 AND layer_id=$2', [featureId,id])
      throw found.rowCount ? new HttpProblem(409, 'VERSION_CONFLICT', '此档案已更新，请保留草稿并重新加载') :
        new HttpProblem(404, 'NOT_FOUND', '档案不存在')
    }
    return featureJson(result.rows[0])
  })
  app.post<{ Params: { id: string } }>('/api/v1/layers/:id/features', async (request, reply) => {
    const id = numberId(request.params.id)
    const who = await requireScope(request, 'archive:edit', 'layer', id)
    const input = createInput.safeParse(request.body)
    if (!input.success) throw new HttpProblem(400, 'BAD_INPUT', '字段或几何格式无效')
    const exists = await pool.query('SELECT id FROM renewal.layers WHERE id=$1', [id])
    if (!exists.rowCount) throw new HttpProblem(404, 'NOT_FOUND', '图层不存在')
    await checkPointLayer(id, input.data.geometry.type)
    const result = await pool.query(`INSERT INTO renewal.features
      (layer_id,source_feature_id,properties,geom,updated_by)
      VALUES($1,$2,$3::jsonb,ST_SetSRID(ST_GeomFromGeoJSON($4),4326),$5)
      RETURNING id,layer_id,version,properties,ST_AsGeoJSON(geom,15)::json AS geometry`,
      [id,`online-${randomUUID()}`,JSON.stringify(input.data.properties),JSON.stringify(input.data.geometry),who.username])
    reply.code(201)
    return featureJson(result.rows[0])
  })
}
