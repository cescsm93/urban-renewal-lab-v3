const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { classify, matchesAccessCode } = require('./api/copilot')._test;
const { createHash } = require('node:crypto');

const dataDir = process.env.QWEN_BRIDGE_DATA_DIR || path.join(__dirname, '.local-data');
fs.mkdirSync(dataDir, { recursive: true });
function secret(file, bytes) {
  const location = path.join(dataDir, file);
  if (!fs.existsSync(location)) fs.writeFileSync(location, randomBytes(bytes).toString('base64url'), { flag: 'wx' });
  return fs.readFileSync(location, 'utf8').trim();
}
const tokenDigest = createHash('sha256').update(secret('online-qwen-bridge.txt', 32)).digest('hex');
secret('online-qwen-access.txt', 16);

const port = Number(process.env.QWEN_BRIDGE_PORT || 4194);
let busy = false;
let windowEnd = 0;
let calls = 0;
function reply(res, status, result) {
  if (res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(result));
}

async function readQuestion(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) throw Error('问题太长');
    chunks.push(chunk);
  }
  const { question } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof question !== 'string' || question.trim().length < 2 || question.length > 300) throw Error('请输入 2 至 300 字的问题');
  return question.trim();
}

const server = http.createServer(async (req, res) => {
  if (req.url !== '/classify' || req.method !== 'POST') return reply(res, 404, { error: '接口不存在' });
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ') || !matchesAccessCode(auth.slice(7), tokenDigest)) {
    return reply(res, 401, { error: '连接认证失败' });
  }
  let question;
  try { question = await readQuestion(req); }
  catch { return reply(res, 400, { error: '问题格式无效' }); }
  if (busy) return reply(res, 429, { error: '主机正在回答另一条问题，请稍后再试' });
  if (Date.now() >= windowEnd) {
    windowEnd = Date.now() + 24 * 60 * 60 * 1000;
    calls = 0;
  }
  if (calls >= 30) return reply(res, 429, { error: '在线试用已达本轮 30 次调用上限' });
  calls++;
  busy = true;
  try { reply(res, 200, { intent: await classify(question, 65000) }); }
  catch { reply(res, 502, { error: '主机 Qwen 暂时不可用' }); }
  finally { busy = false; }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(port, '127.0.0.1', () => console.log('Authenticated Qwen bridge ready on loopback port ' + port));
