const { randomUUID } = require('node:crypto');
const { connection } = require('./postgis-db.cjs');
const { readJson } = require('./shared-store.cjs');

const workspaceName = process.env.RENEWAL_ARCHIVE_WORKSPACE || '四层档案';
const managedNames = ['项目层', '宗地层', '建筑层', '规划用地层'];
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const namePattern = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

async function canEdit(username) {
  if (username === 'admin') return true;
  if (!username) return false;
  const result = await connection().query('SELECT 1 FROM renewal.archive_editors WHERE username=$1', [username]);
  return !!result.rowCount;
}

async function readArchive() {
  const result = await connection().query(`SELECT l.id AS layer_id,l.name,l.field_order,l.source_filename,
    l.source_crs,l.registration_note,f.id AS feature_id,f.version,f.properties,
    ST_AsGeoJSON(f.geom,15)::json AS geometry
    FROM renewal.layers l JOIN renewal.workspaces w ON w.id=l.workspace_id
    LEFT JOIN renewal.features f ON f.layer_id=l.id
    WHERE w.name=$1 ORDER BY l.id,f.id`, [workspaceName]);
  if (!result.rowCount) fail(404, '空间档案四层尚未导入 PostGIS');
  const rows = new Map();
  for (const row of result.rows) {
    if (!managedNames.includes(row.name)) continue;
    if (!rows.has(row.layer_id)) rows.set(row.layer_id, {
      name: row.name, dbLayerId: String(row.layer_id),
      sourceCRS: row.source_crs, sourceFilename: row.source_filename,
      registrationNote: row.registration_note,
      collection: { type: 'FeatureCollection', features: [] }
    });
    if (row.geometry) {
      const ordered = Object.fromEntries([
        ...row.field_order.filter(key => Object.hasOwn(row.properties, key)).map(key => [key, row.properties[key]]),
        ...Object.entries(row.properties).filter(([key]) => !row.field_order.includes(key))
      ]);
      rows.get(row.layer_id).collection.features.push({ type: 'Feature',
        dbId: String(row.feature_id), dbVersion: row.version,
        properties: ordered, geometry: row.geometry });
    }
  }
  const layers = [...rows.values()];
  if (layers.length !== 4) fail(500, '空间档案四层不完整，请检查 PostGIS 导入');
  return { workspace: workspaceName, layers, total: layers.reduce((n, row) => n + row.collection.features.length, 0),
    approximateRegistration: true };
}

async function readFeature(id) {
  if (!/^\d+$/.test(id)) fail(400, '记录编号无效');
  const result = await connection().query(`SELECT f.id,f.version,f.properties,
    ST_AsGeoJSON(f.geom,15)::json AS geometry,l.name AS layer_name
    FROM renewal.features f JOIN renewal.layers l ON l.id=f.layer_id
    JOIN renewal.workspaces w ON w.id=l.workspace_id
    WHERE f.id=$1 AND w.name=$2 AND l.name=ANY($3)`,
  [id, workspaceName, managedNames]);
  if (!result.rowCount) fail(404, '档案记录不存在');
  const row = result.rows[0];
  return { layerName: row.layer_name, feature: { type:'Feature',
    dbId:String(row.id), dbVersion:row.version,
    properties:row.properties, geometry:row.geometry } };
}

async function readCrossRelations(id, records) {
  if (!records.length) return [];
  const result = await connection().query(`WITH target AS (
      SELECT geom FROM renewal.features WHERE id=$1
    ), clipped AS MATERIALIZED (
      SELECT f.id,l.name AS layer_name,f.properties,
        ST_Intersection(f.geom,t.geom) AS geom
      FROM renewal.features f JOIN renewal.layers l ON l.id=f.layer_id
      CROSS JOIN target t WHERE f.id=ANY($2::bigint[])
    ), pairs AS (
      SELECT a.id AS from_id,b.id AS to_id,a.layer_name AS from_layer,
        b.layer_name AS to_layer,
        COALESCE(a.properties->>'宗地编号'=b.properties->>'关联宗地编号',false)
          AND a.layer_name='宗地层' AND b.layer_name='建筑层' AS field_match,
        ST_Intersects(a.geom,b.geom) AS spatial_match,
        round(ST_Area(ST_CollectionExtract(
          ST_Intersection(a.geom,b.geom),3)::geography)::numeric,2) AS overlap_sqm
      FROM clipped a JOIN clipped b ON
        (a.layer_name='宗地层' AND b.layer_name IN ('建筑层','规划用地层')) OR
        (a.layer_name='建筑层' AND b.layer_name='规划用地层')
    )
    SELECT * FROM pairs WHERE field_match OR spatial_match
    ORDER BY from_layer,from_id,to_layer,to_id`,
  [id, records.map(row => row.id)]);
  const byId = new Map(records.map(row => [row.id,row]));
  return result.rows.map(row => {
    const from = byId.get(String(row.from_id));
    const to = byId.get(String(row.to_id));
    const area = Number(row.overlap_sqm);
    const fieldMatch = row.field_match;
    return { fromId:from.id, fromCode:from.code, fromLayer:from.layer,
      toId:to.id, toCode:to.code, toLayer:to.layer,
      fieldMatch, spatialMatch:row.spatial_match, overlapSqm:area,
      relation:fieldMatch && area >= 0.01 ? '字段关联＋图形交叠' :
        fieldMatch && row.spatial_match ? '字段关联＋边界接触' :
        fieldMatch ? '字段关联，图形未叠' : area >= 0.01 ?
          (from.layer === '宗地层' && to.layer === '建筑层' ?
            '图形交叠，字段未关联' : '图形交叠') : '仅边界接触' };
  });
}

async function readProjectContext(id) {
  if (!/^\d+$/.test(id)) fail(400, '项目记录编号无效');
  const result = await connection().query(`WITH target AS (
      SELECT f.geom,f.version,f.properties->>'项目编号' AS project_code FROM renewal.features f
      JOIN renewal.layers l ON l.id=f.layer_id
      JOIN renewal.workspaces w ON w.id=l.workspace_id
      WHERE f.id=$1 AND w.name=$2 AND l.name='项目层'
    )
    SELECT l.name,f.id,f.properties,t.version AS project_version,t.project_code,
      ST_Intersects(f.geom,t.geom) AS spatial_match,
      round(ST_Area(ST_Intersection(f.geom,t.geom)::geography)::numeric,2) AS overlap_sqm,
      round(ST_Area(f.geom::geography)::numeric,2) AS feature_sqm,
      round(ST_Area(t.geom::geography)::numeric,2) AS project_sqm
    FROM target t JOIN renewal.layers l ON l.name=ANY($3)
      JOIN renewal.workspaces w ON w.id=l.workspace_id AND w.name=$2
    LEFT JOIN renewal.features f ON f.layer_id=l.id AND (
      ST_Intersects(f.geom,t.geom) OR
      (l.name IN ('宗地层','建筑层') AND t.project_code IS NOT NULL AND
        f.properties->>'关联项目编号'=t.project_code))
    ORDER BY l.name,f.id`, [id, workspaceName, ['宗地层','建筑层','规划用地层']]);
  if (!result.rowCount) fail(404, '项目档案不存在');
  const names = ['宗地层','建筑层','规划用地层'];
  const counts = Object.fromEntries(names.map(name => [name,0]));
  const linkedCounts = Object.fromEntries(names.map(name => [name,0]));
  const records = [];
  for (const row of result.rows) {
    if (!row.id) continue;
    const p = row.properties || {};
    const overlapSqm = Number(row.overlap_sqm);
    const featureSqm = Number(row.feature_sqm);
    const projectSqm = Number(row.project_sqm);
    const linked = !!row.project_code && p['关联项目编号'] === row.project_code;
    const code = p['宗地编号'] || p['建筑编号'] || p['规划地块编号'] || String(row.id);
    if (row.spatial_match) counts[row.name]++;
    if (linked) linkedCounts[row.name]++;
    records.push({ id:String(row.id), layer:row.name, code,
      name:p['宗地名称'] || p['建筑名称'] || p['规划用地性质'] || code,
      linked, spatialMatch:row.spatial_match, projectLink:p['关联项目编号'] || null,
      parcelLink:p['关联宗地编号'] || null,
      overlapSqm, overlapShare:featureSqm ? +(overlapSqm / featureSqm).toFixed(4) : null,
      projectShare:projectSqm ? +(overlapSqm / projectSqm).toFixed(4) : null,
      relation:linked && !row.spatial_match ? '档案关联，图形未叠' : linked ? '档案关联' :
        overlapSqm < 0.01 ? '仅边界接触' :
        (row.name === '规划用地层' ? overlapSqm / projectSqm : overlapSqm / featureSqm) < 0.05
          ? '边缘擦入' : '空间交叠待核',
      use:p['规划用地性质'] || p['建筑使用功能'] || p['现状用地性质'] || null,
      floors:p['建筑层数'] ?? null, estimatedGfa:p['建筑面积'] ?? null,
      planningVersion:p['规划版本'] || null, planningStatus:p['规划状态'] || null,
      planningFar:p['规划容积率'] || null,
      owner:p['土地使用权人'] || null });
  }
  const crossRelations = await readCrossRelations(id,records);
  const crossGaps = [];
  for (const row of records) {
    if (row.layer === '建筑层') {
      const parcels = crossRelations.filter(pair => pair.toId === row.id &&
        pair.fromLayer === '宗地层');
      const plans = crossRelations.filter(pair => pair.fromId === row.id &&
        pair.toLayer === '规划用地层');
      if (!parcels.some(pair => pair.overlapSqm >= 0.01))
        crossGaps.push({id:row.id,code:row.code,layer:row.layer,issue:'项目范围内未与宗地形成面积交叠'});
      if (row.parcelLink && !parcels.some(pair => pair.fromCode === row.parcelLink && pair.fieldMatch))
        crossGaps.push({id:row.id,code:row.code,layer:row.layer,
          issue:'关联宗地 '+row.parcelLink+' 不在本项目候选宗地中'});
      if (!plans.some(pair => pair.overlapSqm >= 0.01))
        crossGaps.push({id:row.id,code:row.code,layer:row.layer,issue:'项目范围内未匹配到规划图斑'});
    }
    if (row.layer === '宗地层' && row.linked && !crossRelations.some(pair =>
      pair.fromId === row.id && pair.toLayer === '规划用地层' && pair.overlapSqm >= 0.01))
      crossGaps.push({id:row.id,code:row.code,layer:row.layer,issue:'关联宗地未匹配到规划图斑'});
  }
  return { recordId:id, projectVersion:result.rows[0].project_version,
    counts,linkedCounts,records,crossRelations,crossGaps,
    method:'ST_Intersects 包含边界接触；档案关联依据“关联项目编号”；交叠面积为示意配准量算。',
    warning:'四层均为示意配准，叠加结果仅供前期核查，不能作法定边界或精确统计。' };
}

function validProperties(input, fieldOrder) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '属性字段格式无效');
  const keys = Object.keys(input).filter(key => key !== '_archiveTitle');
  if (keys.length !== fieldOrder.length || keys.some(key => !fieldOrder.includes(key)) ||
      keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) {
    fail(400, '只能修改本图层已有的原始字段');
  }
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== '_archiveTitle'));
}

function validGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) ||
      !Array.isArray(geometry.coordinates)) fail(400, '当前四层只接受面或多面边界');
  return JSON.stringify(geometry);
}

async function updateFeature(id, body, username) {
  if (!(await canEdit(username))) fail(403, '只有管理员或获授权同事可以修改档案');
  if (!/^\d+$/.test(id) || !Number.isInteger(body.version) || body.version < 1) fail(400, '记录或版本无效');
  const db = await connection().connect();
  try {
    await db.query('BEGIN');
    const current = await db.query(`SELECT f.id,f.version,l.field_order
      FROM renewal.features f JOIN renewal.layers l ON l.id=f.layer_id
      JOIN renewal.workspaces w ON w.id=l.workspace_id
      WHERE f.id=$1 AND w.name=$2 AND l.name=ANY($3) FOR UPDATE OF f`,
    [id, workspaceName, managedNames]);
    if (!current.rowCount) fail(404, '档案记录不存在');
    if (current.rows[0].version !== body.version) fail(409, '同事已修改该条档案，请重新加载后再编辑');
    if (body.properties === undefined && body.geometry === undefined) fail(400, '没有需要保存的修改');
    const properties = body.properties === undefined ? null :
      JSON.stringify(validProperties(body.properties, current.rows[0].field_order));
    const geometry = body.geometry === undefined ? null : validGeometry(body.geometry);
    const updated = await db.query(`UPDATE renewal.features SET
      properties=COALESCE($2::jsonb,properties),
      geom=CASE WHEN $3::text IS NULL THEN geom ELSE ST_SetSRID(ST_GeomFromGeoJSON($3),4326) END,
      version=version+1,updated_at=now(),updated_by=$4
      WHERE id=$1 RETURNING id,version`, [id, properties, geometry, username]);
    await db.query('COMMIT');
    return { dbId: String(updated.rows[0].id), dbVersion: updated.rows[0].version };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

async function addFeature(layerId, body, username) {
  if (!(await canEdit(username))) fail(403, '只有管理员或获授权同事可以新增档案');
  if (!/^\d+$/.test(layerId)) fail(400, '图层编号无效');
  const db = await connection().connect();
  try {
    const layer = await db.query(`SELECT l.id,l.field_order FROM renewal.layers l
      JOIN renewal.workspaces w ON w.id=l.workspace_id
      WHERE l.id=$1 AND w.name=$2 AND l.name=ANY($3)`, [layerId, workspaceName, managedNames]);
    if (!layer.rowCount) fail(404, '档案图层不存在');
    const properties = validProperties(body.properties, layer.rows[0].field_order);
    const geometry = validGeometry(body.geometry);
    const inserted = await db.query(`INSERT INTO renewal.features
      (layer_id,source_feature_id,properties,geom,updated_by)
      VALUES($1,$2,$3::jsonb,ST_SetSRID(ST_GeomFromGeoJSON($4),4326),$5)
      RETURNING id,version`, [layerId, 'online-' + randomUUID(), JSON.stringify(properties), geometry, username]);
    return { dbId: String(inserted.rows[0].id), dbVersion: inserted.rows[0].version };
  } finally { db.release(); }
}

async function changeAccess(body, username, hasUser) {
  if (username !== 'admin') fail(403, '只有管理员可以授权');
  const target = String(body.username || '').trim().toLowerCase();
  if (!namePattern.test(target) || target === 'admin' || !hasUser?.(target))
    fail(400, '请先在“共享项目”中创建该同事账号');
  if (body.editor === true) {
    await connection().query(`INSERT INTO renewal.archive_editors(username,granted_by) VALUES($1,$2)
      ON CONFLICT(username) DO UPDATE SET granted_at=now(),granted_by=EXCLUDED.granted_by`, [target, username]);
  } else if (body.editor === false) {
    await connection().query('DELETE FROM renewal.archive_editors WHERE username=$1', [target]);
  } else fail(400, '授权状态无效');
  return { username: target, editor: body.editor };
}

function send(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handler(req, res, url) {
  const username = req.archiveUser === undefined ? 'admin' : req.archiveUser;
  try {
    const endpoint = url.pathname;
    if (endpoint === '/api/postgis/archive' && req.method === 'GET') return send(res, 200, await readArchive());
    if (endpoint === '/api/postgis/archive/access') {
      if (req.method === 'GET') {
        const editors = username === 'admin'
          ? (await connection().query('SELECT username FROM renewal.archive_editors ORDER BY username')).rows.map(row => row.username)
          : undefined;
        return send(res, 200, { username, editable: await canEdit(username), editors });
      }
      if (req.method === 'POST') return send(res, 200,
        await changeAccess(await readJson(req, 4096), username, req.archiveHasUser));
    }
    const feature = endpoint.match(/^\/api\/postgis\/archive\/features\/(\d+)$/);
    if (feature && req.method === 'GET') return send(res, 200, await readFeature(feature[1]));
    const projectContext = endpoint.match(/^\/api\/postgis\/archive\/projects\/(\d+)\/context$/);
    if (projectContext && req.method === 'GET') return send(res, 200,
      await readProjectContext(projectContext[1]));
    if (feature && req.method === 'PATCH') return send(res, 200,
      await updateFeature(feature[1], await readJson(req, 2 * 1024 * 1024), username));
    const layer = endpoint.match(/^\/api\/postgis\/archive\/layers\/(\d+)\/features$/);
    if (layer && req.method === 'POST') return send(res, 201,
      await addFeature(layer[1], await readJson(req, 2 * 1024 * 1024), username));
    return send(res, 405, { error: '不支持的档案操作' });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    if (['23514','22023','XX000','22P02'].includes(error.code))
      return send(res, 400, { error: '边界无效或坐标不在 WGS84 经纬度范围内' });
    if (['ECONNREFUSED','ETIMEDOUT','ENOENT'].includes(error.code))
      return send(res, 503, { error: '本机 PostGIS 未启动' });
    console.error('PostGIS archive request failed:', error);
    return send(res, 500, { error: '档案数据库操作失败，请查看本机日志' });
  }
}

module.exports = { handler, readArchive, readFeature, readProjectContext, canEdit, updateFeature, addFeature, changeAccess };
