const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { readJson } = require('./shared-store.cjs');

const workspaceName = '__renewal_postgis_pilot__';
const layerName = '项目层';
const envFile = path.join(__dirname, '..', '.local-data', 'postgis.env');
let pool;

function connection() {
  if (!pool) {
    const settings = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
      .filter(line => line.includes('=')).map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }));
    pool = new Pool({ host: '127.0.0.1', port: 5432,
      database: settings.POSTGRES_DB, user: settings.POSTGRES_USER,
      password: settings.POSTGRES_PASSWORD, max: 3, connectionTimeoutMillis: 3000 });
  }
  return pool;
}

function validLayer(input) {
  const row = input?.layer;
  if (row?.name !== layerName || row.collection?.type !== 'FeatureCollection' ||
      !Array.isArray(row.collection.features) || !row.collection.features.length ||
      row.collection.features.length > 5000) throw Object.assign(Error('请选择含 1–5000 条记录的项目层'), { status: 400 });
  if (row.collection.crs && !/EPSG:4326|CRS84|urn:ogc:def:crs:OGC:1.3:CRS84/i.test(
    String(row.collection.crs.properties?.name || ''))) {
    throw Object.assign(Error('项目层须先转换为 WGS84 经纬度'), { status: 400 });
  }
  for (const feature of row.collection.features) {
    if (feature?.type !== 'Feature' || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) ||
        !feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties)) {
      throw Object.assign(Error('项目层需包含面或多面几何及属性字段'), { status: 400 });
    }
  }
  return row;
}

async function savePilot(row) {
  const db = await connection().connect();
  try {
    await db.query('BEGIN');
    const workspace = await db.query(`INSERT INTO renewal.workspaces(name) VALUES($1)
      ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [workspaceName]);
    const workspaceId = workspace.rows[0].id;
    const existing = await db.query('SELECT id FROM renewal.layers WHERE workspace_id=$1 AND name=$2',
      [workspaceId, layerName]);
    if (existing.rowCount) {
      await db.query('ROLLBACK');
      throw Object.assign(Error('试点项目层已经入库。请使用“从 PostGIS 读回”；现阶段不会覆盖现有记录。'), { status: 409 });
    }
    const fieldOrder = [...new Set(row.collection.features.flatMap(f => Object.keys(f.properties)))];
    const layer = await db.query(`INSERT INTO renewal.layers
      (workspace_id,name,kind,source_filename,source_crs,registration_note,field_order)
      VALUES($1,$2,'project',$3,'EPSG:4326',$4,$5) RETURNING id`,
    [workspaceId, layerName, '页面项目层', '试点副本；源文件与坐标配准依据仍以原档案为准', fieldOrder]);
    for (const [index, feature] of row.collection.features.entries()) {
      await db.query(`INSERT INTO renewal.features(layer_id,source_feature_id,properties,geom)
        VALUES($1,$2,$3::jsonb,ST_SetSRID(ST_GeomFromGeoJSON($4),4326))`,
      [layer.rows[0].id, String(index + 1), JSON.stringify(feature.properties), JSON.stringify(feature.geometry)]);
    }
    await db.query('COMMIT');
    return { name: layerName, count: row.collection.features.length, layerId: layer.rows[0].id };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    throw error;
  } finally { db.release(); }
}

async function readPilot() {
  const result = await connection().query(`SELECT l.id,l.name,l.field_order,
      f.source_feature_id,f.properties,ST_AsGeoJSON(f.geom,15)::json AS geometry
    FROM renewal.layers l
    JOIN renewal.workspaces w ON w.id=l.workspace_id
    LEFT JOIN renewal.features f ON f.layer_id=l.id
    WHERE w.name=$1 AND l.name=$2 ORDER BY f.id`, [workspaceName, layerName]);
  if (!result.rowCount) throw Object.assign(Error('PostGIS 里还没有项目层试点数据'), { status: 404 });
  const fields = result.rows[0].field_order;
  const features = result.rows.filter(row => row.geometry).map(row => {
    const properties = Object.fromEntries([
      ...fields.filter(key => Object.hasOwn(row.properties, key)).map(key => [key, row.properties[key]]),
      ...Object.entries(row.properties).filter(([key]) => !fields.includes(key))
    ]);
    return { type: 'Feature', geometry: row.geometry, properties };
  });
  return { layer: { name: layerName, collection: { type: 'FeatureCollection', features } },
    count: features.length, layerId: result.rows[0].id };
}

function send(res, status, data) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handler(req, res) {
  try {
    if (req.method === 'GET') return send(res, 200, await readPilot());
    if (req.method === 'POST') return send(res, 201, await savePilot(validLayer(await readJson(req, 20 * 1024 * 1024))));
    return send(res, 405, { error: '仅支持读取或复制项目层' });
  } catch (error) {
    if (error.status) return send(res, error.status, { error: error.message });
    if (error.code === '23514' || error.code === '22023' || error.code === 'XX000')
      return send(res, 400, { error: '项目层几何无效或坐标超出 WGS84 范围；请检查原文件坐标系' });
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOENT')
      return send(res, 503, { error: '本机 PostGIS 未启动，请先打开 Docker Desktop 并运行数据库启动脚本' });
    console.error('PostGIS pilot request failed:', error);
    return send(res, 500, { error: 'PostGIS 操作失败，请查看本机服务日志' });
  }
}

module.exports = { handler, savePilot, readPilot, validLayer };
