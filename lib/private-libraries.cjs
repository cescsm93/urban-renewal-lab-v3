const fs = require('node:fs');
const path = require('node:path');

const files = {
  '/api/partner-library': 'partner-library.json',
  '/api/scenario-library': 'scenario-library.json'
};
const directory = process.env.RENEWAL_DATA_DIR || path.join(__dirname, '..', '.local-data');

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

module.exports = function privateLibrary(req, res) {
  const host = req.headers.host || '';
  const remote = req.socket.remoteAddress || '';
  const local = /^(?:127\.0\.0\.1|localhost):\d+$/.test(host) &&
    ['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(remote);
  if (!(local || req.privateLibraryAuthorized === true) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)) {
    return send(res, 403, { error: '此资料库仅允许本机或已登录的局域网用户访问' });
  }
  if (req.method !== 'GET') return send(res, 405, { error: '仅支持查看资料库' });
  const name = files[new URL(req.url, 'http://localhost').pathname];
  if (!name) return send(res, 404, { error: '资料库不存在' });
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) {
    return send(res, 200, { kind: name === 'scenario-library.json' ? 'scenario-library' : 'partner-library', records: [], available: false });
  }
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) throw Error('资料库文件过大');
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(payload.records)) throw Error('资料库格式无效');
    return send(res, 200, { ...payload, available: true });
  } catch {
    return send(res, 503, { error: '本地资料库无法读取' });
  }
};
