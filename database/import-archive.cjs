const fs = require('node:fs');
const path = require('node:path');
const { connection } = require('../lib/postgis-db.cjs');

const workspaceName = process.env.RENEWAL_ARCHIVE_WORKSPACE || '四层档案';
const kinds = new Map([['项目层', 'project'], ['宗地层', 'parcel'],
  ['建筑层', 'building'], ['规划用地层', 'planned_land']]);
const sourceFolder = process.argv[2];
if (!sourceFolder) throw Error('请传入包含四层 GeoJSON 和导出清单的本机目录');
const folder = path.resolve(sourceFolder);
const manifest = JSON.parse(fs.readFileSync(path.join(folder, '导出清单.json'), 'utf8'));
if (manifest.target_crs !== 'EPSG:4326' || !/approximate/i.test(manifest.status || '') ||
    manifest.layers?.length !== kinds.size ||
    new Set(manifest.layers.map(layer => layer.layer)).size !== kinds.size) throw Error('来源清单或示意配准说明不匹配');

async function main() {
  const db = await connection().connect();
  try {
    await db.query('BEGIN');
    const exists = await db.query('SELECT id FROM renewal.workspaces WHERE name=$1', [workspaceName]);
    if (exists.rowCount) throw Error('目标工作区已存在，请先核对已有档案');
    const workspace = await db.query('INSERT INTO renewal.workspaces(name) VALUES($1) RETURNING id', [workspaceName]);
    const workspaceId = workspace.rows[0].id;
    const result = [];
    for (const info of manifest.layers) {
      if (!kinds.has(info.layer) || !Number.isSafeInteger(info.features) || info.features < 0 || !Array.isArray(info.fields) ||
          path.basename(info.file) !== info.file) throw Error('图层清单与预期不符：' + info.layer);
      const document = JSON.parse(fs.readFileSync(path.join(folder, info.file), 'utf8'));
      if (document.type !== 'FeatureCollection' || document.features?.length !== info.features ||
          (info.features > 0 && Object.keys(document.features[0]?.properties || {}).join('\u0000') !== info.fields.join('\u0000'))) {
        throw Error('图层记录数或原始字段不符：' + info.layer);
      }
      const layer = await db.query(`INSERT INTO renewal.layers
        (workspace_id,name,kind,source_filename,source_crs,registration_note,field_order)
        VALUES($1,$2,$3,$4,'EPSG:4326',$5,$6) RETURNING id`,
      [workspaceId, info.layer, kinds.get(info.layer), info.file,
        '示意配准，不能作为法定边界或精确测距依据。',
        info.fields]);
      await db.query(`INSERT INTO renewal.features(layer_id,source_feature_id,properties,geom)
        SELECT $1, ordinal::text, item->'properties',
          ST_SetSRID(ST_GeomFromGeoJSON((item->'geometry')::text),4326)
        FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS payload(item,ordinal)`,
      [layer.rows[0].id, JSON.stringify(document.features)]);
      const check = await db.query(`SELECT count(*)::integer AS count,
        ST_XMin(ST_Extent(geom)) AS min_x, ST_YMin(ST_Extent(geom)) AS min_y,
        ST_XMax(ST_Extent(geom)) AS max_x, ST_YMax(ST_Extent(geom)) AS max_y
        FROM renewal.features WHERE layer_id=$1`, [layer.rows[0].id]);
      if (check.rows[0].count !== info.features || check.rows[0].min_x < -180 ||
          check.rows[0].max_x > 180 || check.rows[0].min_y < -90 ||
          check.rows[0].max_y > 90) throw Error('导入后的条数或经纬度范围不符：' + info.layer);
      result.push({ name: info.layer, count: check.rows[0].count, fields: info.fields.length });
    }
    await db.query('COMMIT');
    console.log(JSON.stringify({ workspace: workspaceName, layers: result, approximateRegistration: true }));
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); await connection().end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
