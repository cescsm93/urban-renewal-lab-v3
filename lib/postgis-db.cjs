const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

let pool;
function connection() {
  if (!pool) {
    const envFile = path.join(__dirname, '..', '.local-data', 'postgis.env');
    const settings = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
      .filter(line => line.includes('=')).map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }));
    pool = new Pool({ host: '127.0.0.1', port: 5432,
      database: settings.POSTGRES_DB, user: settings.POSTGRES_USER,
      password: settings.POSTGRES_PASSWORD, max: 5, connectionTimeoutMillis: 3000 });
  }
  return pool;
}
module.exports = { connection };
