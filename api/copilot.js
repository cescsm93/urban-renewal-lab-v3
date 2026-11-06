const {take} = require('../lib/usage-guard.cjs');
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

async function classify(question) {
  const response=await fetch('http://127.0.0.1:11434/api/chat',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.OLLAMA_MODEL||'qwen2.5:7b-instruct-q4_K_M',stream:false,format:'json',options:{temperature:0,num_predict:180},messages:[{role:'system',content:'你是城市更新地图查询意图识别器。只返回JSON：metric=count|area|largest|breakdown|find|help；scope=all|view|filter；category=industrial|residential|public|commercial|other|null；searchText=字符串。问数量选count，面积合计选area，最大面积选largest，分类选breakdown，按名称定位选find，其余选help。仅明确提到视野才用view，筛选才用filter。'},{role:'user',content:question}]}),
    signal:AbortSignal.timeout(90000)
  });
  if(!response.ok)throw Error('本机 Ollama 不可用，请检查模型是否已下载');
  const data=await response.json();const intent=normalizeIntent(data?.message?.content);
  intent.scope=/视野|视窗|当前地图|屏幕内/.test(question)?'view':/筛选|过滤/.test(question)?'filter':'all';
  return intent;
}

async function handler(req, res) {
  const send = (status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };
  if (req.method !== 'POST') return send(405, {error:'仅支持 POST'});
  let input;
  try { input = validateInput(await readBody(req)); }
  catch (e) { return send(400, {error:e.message}); }
  if (process.env.VERCEL || process.env.COPILOT_AI_ENABLED === 'false') return send(503, {error:'此环境使用规则查询；Qwen 仅在本机服务启用'});
  const quota = take(req, 'copilot');
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfter));
    return send(429, {error:'地图 Copilot 今日或近期提问次数已达保护上限'});
  }
  try {
    const intent = await classify(input.question);
    return send(200, {...answer(input, intent), mode:'ollama'});
  } catch (e) {
    return send(502, {error:e.name === 'TimeoutError' ? 'Ollama 回答超时' : e.message});
  }
}

module.exports = handler;
module.exports._test = {readBody, classify};
