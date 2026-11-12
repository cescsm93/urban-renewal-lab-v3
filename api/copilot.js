const {createHash, timingSafeEqual} = require('node:crypto');
const {take} = require('../lib/usage-guard.cjs');
const {validateAssessment, assessProject} = require('../lib/project-assessment.cjs');
const {validateInput, normalizeIntent, answer} = require('../lib/copilot-core.cjs');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 90000) throw Error('请求数据过大');
  }
  return JSON.parse(body);
}

async function classify(question, timeoutMs = 90000) {
  const response=await fetch('http://127.0.0.1:11434/api/chat',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.OLLAMA_MODEL||'qwen2.5:7b-instruct-q4_K_M',stream:false,format:'json',options:{temperature:0,num_predict:180},messages:[{role:'system',content:'你是城市更新地图查询意图识别器。只返回JSON：metric=count|area|largest|breakdown|find|help；scope=all|view|filter；category=industrial|residential|public|commercial|other|null；searchText=字符串。问数量选count，面积合计选area，最大面积选largest，分类选breakdown，按名称定位选find，其余选help。仅明确提到视野才用view，筛选才用filter。'},{role:'user',content:question}]}),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok)throw Error('本机 Ollama 不可用，请检查模型是否已下载');
  const data=await response.json();const intent=normalizeIntent(data?.message?.content);
  intent.scope=/视野|视窗|当前地图|屏幕内/.test(question)?'view':/筛选|过滤/.test(question)?'filter':'all';
  return intent;
}

let assessmentRunning = false;

function matchesAccessCode(code, digest) {
  if (typeof code !== 'string' || code.length > 128 || !/^[a-f0-9]{64}$/.test(digest || '')) return false;
  return timingSafeEqual(createHash('sha256').update(code.trim()).digest(), Buffer.from(digest, 'hex'));
}

async function classifyThroughBridge(question) {
  const url = new URL('/classify', process.env.QWEN_BRIDGE_URL);
  if (url.protocol !== 'https:') throw Error('在线模型连接配置无效');
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.QWEN_BRIDGE_TOKEN
      },
      body: JSON.stringify({ question }),
      redirect: 'error',
      signal: AbortSignal.timeout(75000)
    });
  } catch {
    throw Error('本机模型暂时无法连接，请稍后再试');
  }
  if (response.status === 429) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(Error(result.error || '本机模型正在忙，请稍后再试'), { status: 429 });
  }
  if (!response.ok) throw Error('本机模型暂时无法连接，请稍后再试');
  const result = await response.json();
  return normalizeIntent(result.intent);
}

async function handler(req, res) {
  const send = (status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };
  if (req.method !== 'POST') return send(405, {error:'仅支持 POST'});
  const online = !!process.env.VERCEL;
  if (process.env.COPILOT_AI_ENABLED === 'false') return send(503, {error:'模型暂未启用'});
  if (online) {
    const { QWEN_BRIDGE_URL, QWEN_BRIDGE_TOKEN, QWEN_ACCESS_CODE_SHA256 } = process.env;
    if (!QWEN_BRIDGE_URL || !QWEN_BRIDGE_TOKEN || !QWEN_ACCESS_CODE_SHA256) return send(503, {error:'在线模型暂未启用'});
    if (!matchesAccessCode(req.headers['x-qwen-access-code'], QWEN_ACCESS_CODE_SHA256)) return send(401, {error:'请输入管理员提供的模型体验口令'});
  }
  let input, assessment;
  try {
    const body = await readBody(req);
    assessment = body?.mode === 'assessment';
    input = assessment ? validateAssessment(body) : validateInput(body);
  }
  catch (e) { return send(400, {error:e.message}); }
  if (online && assessment) return send(503, {error:'完整前期研判仅在本机或局域网启用'});
  if (assessment && assessmentRunning) return send(429, {error:'正在生成另一份研判，请稍后再试'});
  const quota = take(req, 'copilot');
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfter));
    return send(429, {error:'地图 Copilot 今日或近期提问次数已达保护上限'});
  }
  try {
    if (assessment) {
      assessmentRunning = true;
      try { return send(200, { mode: 'assessment', result: await assessProject(input) }); }
      finally { assessmentRunning = false; }
    }
    const intent = online ? await classifyThroughBridge(input.question) : await classify(input.question);
    return send(200, {...answer(input, intent), mode:online ? 'ollama-online' : 'ollama'});
  } catch (e) {
    return send(502, {error:e.name === 'TimeoutError' ? 'Ollama 回答超时' : e.message});
  }
}

module.exports = handler;
module.exports._test = {readBody, classify, matchesAccessCode};
