const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { connection } = require('../lib/postgis-db.cjs');

async function main() {
  const [python, archive, sourceLayer, workspace, company] = process.argv.slice(2);
  if (!workspace || !sourceLayer || !archive || !python)
    throw Error('用法：node database/import-project-points.cjs Python路径 ZIP路径 GDB图层 全省工作区名 [已有公司工作区名]');
  const read = spawnSync(python, [path.join(__dirname, 'read-project-points.py'), archive, sourceLayer],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (read.error || read.status !== 0) throw Error(read.error?.message || read.stderr || 'GDB 读取失败');
  const data = JSON.parse(read.stdout);
  const db = await connection().connect();
  try {
    await db.query('BEGIN');
    await db.query(fs.readFileSync(path.join(__dirname, '006_project_catalog.sql'), 'utf8'));
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['project-catalog:' + workspace]);
    if (company) {
      const existing = await db.query('SELECT id FROM renewal.workspaces WHERE name=$1',[company]);
      if (!existing.rowCount) throw Error('指定的公司项目工作区不存在');
      await classify(existing.rows[0].id, 'company');
    }
    await db.query('INSERT INTO renewal.workspaces(name) VALUES($1) ON CONFLICT(name) DO NOTHING',[workspace]);
    const ws = (await db.query('SELECT id FROM renewal.workspaces WHERE name=$1',[workspace])).rows[0].id;
    await classify(ws, 'province');
    const old = await db.query(`SELECT l.id,l.name,s.archive_sha256
      FROM renewal.layers l LEFT JOIN renewal.project_layer_sources s ON s.layer_id=l.id
      WHERE l.workspace_id=$1 AND (l.name=$2 OR (s.archive_sha256=$3 AND s.gdb_layer=$2))`,[ws,sourceLayer,data.hash]);
    if (old.rowCount) {
      if (old.rowCount !== 1 || old.rows[0].archive_sha256 !== data.hash) throw Error('同名图层已存在，需先核对增量差异');
      await db.query('COMMIT');
      console.log('同一来源已入库，跳过重复写入。图层 ID',old.rows[0].id);
      return;
    }
    const {rows:[{id}]} = await db.query(`INSERT INTO renewal.layers
      (workspace_id,name,kind,source_filename,source_crs,registration_note,field_order)
      VALUES($1,$2,'project',$3,'EPSG:4326',$4,$5) RETURNING id`,
      [ws,sourceLayer,path.basename(archive),'来源为项目点位；空点仅保留属性。点位不能表示项目边界。',data.fields]);
    await db.query(`CREATE TEMP TABLE incoming_projects (fid text PRIMARY KEY,properties jsonb NOT NULL,
      geom geometry(Point,4326) NOT NULL) ON COMMIT DROP`);
    await db.query(`INSERT INTO incoming_projects
      SELECT fid,properties,ST_GeomFromWKB(decode(wkb,'hex'),4326)
      FROM jsonb_to_recordset($1) AS s(fid text,properties jsonb,wkb text)`,[JSON.stringify(data.records)]);
    await db.query(`INSERT INTO renewal.features(layer_id,source_feature_id,properties,geom)
      SELECT $1,fid,properties,geom FROM incoming_projects ORDER BY fid::bigint`,[id]);
    const diff = await db.query(`SELECT fid FROM incoming_projects EXCEPT
      SELECT f.source_feature_id FROM renewal.features f JOIN incoming_projects i
        ON f.source_feature_id=i.fid AND f.properties=i.properties AND ST_AsEWKB(f.geom)=ST_AsEWKB(i.geom)
      WHERE f.layer_id=$1`,[id]);
    if (diff.rowCount) throw Error('数据库回读与来源数据不符');
    await db.query('INSERT INTO renewal.project_layer_sources(layer_id,archive_sha256,gdb_layer) VALUES($1,$2,$3)',[id,data.hash,sourceLayer]);
    await db.query('COMMIT');
    console.log(JSON.stringify({layerId:id,records:data.records.length,fields:data.fields.length,empty:data.empty}));
    async function classify(workspaceId,kind) {
      await db.query('INSERT INTO renewal.workspace_catalog VALUES($1,$2) ON CONFLICT DO NOTHING',[workspaceId,kind]);
      const result = await db.query('SELECT catalog_kind FROM renewal.workspace_catalog WHERE workspace_id=$1',[workspaceId]);
      if (result.rows[0].catalog_kind !== kind) throw Error('工作区已有其他项目库归属');
    }
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); await connection().end(); }
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
