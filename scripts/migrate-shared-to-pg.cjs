const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { connection } = require('../lib/postgis-db.cjs');

async function main() {
  const dir = path.join(__dirname, '..', '.local-data');
  const source = path.join(dir, 'shared-projects.sqlite');
  if (!fs.existsSync(source)) throw Error('共享项目 SQLite 不存在');
  const old = new DatabaseSync(source, { readOnly: true });
  const backup = path.join(dir, 'shared-projects-before-pg.sqlite');
  if (!fs.existsSync(backup)) old.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  const users = old.prepare('SELECT username,salt,password_hash FROM users').all();
  const projects = old.prepare('SELECT id,name,version,updated_at,updated_by,payload FROM projects').all();
  const members = old.prepare('SELECT project_id,username,role FROM members').all();
  old.close();
  console.log(JSON.stringify({ source, backup, users: users.length, projects: projects.length, members: members.length }));
  const db = await connection().connect();
  try {
    await db.query('BEGIN');
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'database', '004_platform.sql'), 'utf8'));
    const counts = await db.query(`SELECT
      (SELECT count(*)::int FROM renewal.app_users) AS users,
      (SELECT count(*)::int FROM renewal.app_projects) AS projects,
      (SELECT count(*)::int FROM renewal.app_project_members) AS members`);
    if (Object.values(counts.rows[0]).some(n => n !== 0)) throw Error('目标平台表非空；停止迁移，避免覆盖');
    for (const user of users) await db.query(
      'INSERT INTO renewal.app_users(username,salt,password_hash) VALUES($1,$2,$3)',
      [user.username,user.salt,user.password_hash]);
    for (const project of projects) await db.query(`INSERT INTO renewal.app_projects
      (id,name,version,payload,updated_at,updated_by) VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
      [project.id,project.name,project.version,project.payload,project.updated_at,project.updated_by]);
    for (const member of members) await db.query(`INSERT INTO renewal.app_project_members
      (project_id,username,role) VALUES($1,$2,$3)`, [member.project_id,member.username,member.role]);
    await db.query(`SELECT setval(pg_get_serial_sequence('renewal.app_projects','id'),
      GREATEST(COALESCE((SELECT max(id) FROM renewal.app_projects),0),1),
      EXISTS(SELECT 1 FROM renewal.app_projects))`);
    await db.query('COMMIT');
    console.log('PG platform tables created and shared metadata imported. Original SQLite unchanged.');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); await connection().end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
