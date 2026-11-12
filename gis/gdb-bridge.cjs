const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const seed = path.join(process.env.RENEWAL_DATA_DIR || path.join(__dirname, '../.local-data'), 'imported-archive.json');
let active = false;

function convert(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.GIS_PYTHON || 'python',
      [path.join(__dirname, 'import_geodatabase.py')],
      { stdio:['pipe','pipe','pipe'], windowsHide:true, env:{...process.env, PYTHONUTF8:'1', PROJ_NETWORK:'OFF'} });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(Error('GDB 转换超时，请检查压缩包')) }, 60000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 30 * 1024 * 1024) {
        child.kill();
        reject(Error('转换结果过大，请拆分图层'));
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timeout); reject(Error('未找到本机 GIS Python 环境')) });
    child.on('close', code => {
      clearTimeout(timeout);
      try {
        const data = JSON.parse(output);
        if (code !== 0 || data.error) reject(Error(data.error || 'GDB 转换失败'));
        else resolve(data);
      } catch {
        reject(Error('GDB 转换结果读取失败'));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function handler(req, res) {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'GET') {
    if (!fs.existsSync(seed)) return send(404, { error:'本机尚无已导入的四层档案' });
    return send(200, JSON.parse(fs.readFileSync(seed, 'utf8')));
  }
  if (req.method !== 'POST') return send(405, { error:'仅支持上传与读取' });
  if (active) return send(429, { error:'已有 GDB 转换进行中' });
  active = true;
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 28 * 1024 * 1024) return send(413, { error:'压缩包最多 20 MB' });
    }
    const data = await convert(JSON.parse(body));
    return send(200, data);
  } catch (error) {
    return send(400, { error:error.message });
  } finally {
    active = false;
  }
}

module.exports = handler;
