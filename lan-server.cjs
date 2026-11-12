const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const server = require('./server.cjs');
const { openSharedStore, readJson } = require('./lib/shared-store.cjs');

const interfaces = Object.entries(os.networkInterfaces())
  .filter(([name]) => !/vEthernet|WSL|Hyper|Meta|Loopback/i.test(name))
  .flatMap(([, addresses]) => addresses)
  .filter(item => item.family === 'IPv4' && !item.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address));
const host = process.env.LAN_HOST || interfaces[0]?.address;
if (!host) throw Error('No LAN IPv4 address found. Connect to office Wi-Fi first.');

const port = Number(process.env.PORT || 4189);
const dir = process.env.RENEWAL_DATA_DIR || path.join(__dirname, '.local-data');
fs.mkdirSync(dir, { recursive: true });
const passFile = path.join(dir, 'lan-access.txt');
if (!fs.existsSync(passFile)) fs.writeFileSync(passFile, randomBytes(12).toString('base64url'));
const guestPassword = Buffer.from(fs.readFileSync(passFile, 'utf8').trim());
const shared = openSharedStore(dir);
const router = server.listeners('request')[0];
server.removeAllListeners('request');
const sessions = new Map();
const attempts = new Map();
const queue = [];
let active = false;

function send(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function drain() {
  if (active || !queue.length) return;
  const job = queue.shift();
  clearTimeout(job.timer);
  if (job.res.destroyed) return drain();
  active = true;
  Promise.resolve(router(job.req, job.res))
    .catch(() => send(job.res, 500, { error: '请求处理失败' }))
    .finally(() => { active = false; drain(); });
}

function queueCopilot(req, res) {
  if (queue.length >= 2) return send(res, 429, { error: '模型正在处理同事的提问，请稍后重试' });
  const job = { req, res };
  job.timer = setTimeout(() => {
    const index = queue.indexOf(job);
    if (index < 0) return;
    queue.splice(index, 1);
    send(res, 429, { error: '排队超过15秒，请稍后重试' });
  }, 15000);
  queue.push(job);
  drain();
}

const loginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Renewal Lab 内网登录</title>
<style>body{font:16px system-ui;color:#183d48;background:#edf4f5}main{max-width:420px;margin:10vh auto;background:white;padding:32px;border-radius:16px}label,input{display:block}input{box-sizing:border-box;width:100%;margin:6px 0 16px;padding:12px;border:1px solid #b9cdd1;border-radius:8px}button{background:#164854;color:white;border:0;border-radius:8px;padding:10px 18px}p{line-height:1.6}#status{color:#a52e38}</style>
<main><h1>Urban Renewal Lab</h1><p>使用成员账号进入共享项目。体验地图、政策知识库和 Qwen 时，可留空账号并输入原网站口令。</p>
<form><label>成员账号<input id="username" autocomplete="username" maxlength="32"></label><label>访问口令<input type="password" id="password" autocomplete="current-password" maxlength="128" required></label><button>进入工作台</button></form><p id="status" role="status"></p></main>
<script>
document.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/lan-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.querySelector('#username').value, password: document.querySelector('#password').value })
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    location.reload();
  } catch (error) {
    document.querySelector('#status').textContent = error.message;
    button.disabled = false;
  }
};
</script></html>`;

async function login(req, res) {
  const now = Date.now();
  for (const [ip, attempt] of attempts) if (now - attempt.start >= 60000) attempts.delete(ip);
  const ip = req.socket.remoteAddress;
  const attempt = attempts.get(ip) || { start: now, count: 0 };
  attempts.set(ip, attempt);
  if (++attempt.count > 5) return send(res, 429, { error: '尝试次数过多，请一分钟后重试' });
  const body = await readJson(req);
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (username.length > 32 || password.length > 128) return send(res, 400, { error: '账号或口令过长' });
  const supplied = Buffer.from(password);
  const valid = username ? shared.authenticate(username, password)
    : supplied.length === guestPassword.length && timingSafeEqual(supplied, guestPassword);
  if (!valid) return send(res, 401, { error: '账号或口令不正确' });
  attempts.delete(ip);
  for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { username, expires: now + 8 * 3600000 });
  res.setHeader('Set-Cookie', 'renewal_lan=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
  send(res, 200, { ok: true });
}

function serveHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

server.on('request', async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.headers.host !== host + ':' + port) return send(res, 403, { error: '访问地址无效' });
    if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return send(res, 403, { error: '仅允许同源访问' });
    if (url.pathname === '/lan-login' && req.method === 'POST') return await login(req, res);
    const token = String(req.headers.cookie || '').match(/(?:^|;\s*)renewal_lan=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) {
      if (url.pathname === '/' && req.method === 'GET') return serveHtml(res, loginPage);
      return send(res, 401, { error: '登录已过期，请刷新页面重新登录' });
    }
    if (url.pathname === '/lan-logout' && req.method === 'POST') {
      sessions.delete(token);
      res.setHeader('Set-Cookie', 'renewal_lan=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/shared/')) {
      const result = await shared.routes(req, url, session.username);
      if (url.pathname === '/api/shared/users' && result.reset) {
        for (const [key, value] of sessions) if (value.username === result.username) sessions.delete(key);
      }
      return send(res, 200, result);
    }
    if (url.pathname === '/shared-workspace.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'lib/shared-workspace.js')));
    }
    if (req.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      return serveHtml(res, html.replace('<!-- LAN_SHARED -->', '<script src="/shared-workspace.js"></script>'));
    }
    if (url.pathname === '/api/local-project') return send(res, 403, { error: '主机本机快照仅供主机使用，请在共享项目入口保存' });
    req.headers['x-forwarded-for'] = req.socket.remoteAddress;
    if (url.pathname === '/api/local-knowledge' || url.pathname === '/api/local-knowledge/source') {
      req.knowledgeLanAuthorized = true;
      if (url.pathname === '/api/local-knowledge' && req.method === 'POST') return queueCopilot(req, res);
    }
    if (url.pathname === '/api/partner-library' || url.pathname === '/api/scenario-library') {
      req.privateLibraryAuthorized = true;
    }
    if (url.pathname === '/api/copilot') return queueCopilot(req, res);
    await router(req, res);
  } catch (error) {
    if (!error.status) console.error(error);
    send(res, error.status || 500, { error: error.status ? error.message : '服务处理失败' });
  }
});

server.listen(port, host, () => {
  console.log('LAN website: http://' + host + ':' + port + '/');
  console.log('Guest password file: ' + passFile);
  console.log('Admin account: admin. Password file: ' + shared.adminPasswordFile);
  console.log('Keep this service and Ollama running.');
});
