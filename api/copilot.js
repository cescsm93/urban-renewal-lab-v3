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

async function classify(question, key) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${key}`},
    body:JSON.stringify({
      model:'deepseek-flash',
      thinking:{type:'disabled'},
      max_tokens:180,
      response_format:{type:'json_object'},
      messages:[
        {role:'system',content:'你是城市更新地图查询的意图识别器。只返回 JSON 对象，不写解释。字段：metric=count|area|largest|breakdown|find|help；scope=all|view|filter；category=industrial|residential|public|commercial|other|null；searchText=字符串。问数量/多少选 count，面积合计选 area，最大/最大面积选 largest，分类/各类选 breakdown，按项目名称定位选 find，不属于这些问题选 help。只有明确提到当前视野/屏幕时才选 view；明确提到筛选时才选 filter。不要根据资源数据臆造事实。'},
        {role:'user',content:question}
      ]
    }),
    signal:AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Error(response.status === 401 ? 'DeepSeek 密钥无效' : response.status === 402 ? 'DeepSeek 账户余额不足' : response.status === 429 ? 'DeepSeek 请求过于频繁' : 'DeepSeek 服务暂不可用');
  const data = await response.json();
  return normalizeIntent(data?.choices?.[0]?.message?.content);
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
  if (process.env.COPILOT_AI_ENABLED !== 'true') return send(503, {error:'DeepSeek 问答尚未开放，已切换为本地规则'});
  if (!process.env.DEEPSEEK_API_KEY) return send(503, {error:'此环境尚未配置 DeepSeek，已切换为本地规则'});
  const quota = take(req, 'copilot');
  if (!quota.allowed) {
    res.setHeader('Retry-After', String(quota.retryAfter));
    return send(429, {error:'地图 Copilot 今日或近期提问次数已达保护上限'});
  }
  try {
    const intent = await classify(input.question, process.env.DEEPSEEK_API_KEY);
    return send(200, {...answer(input, intent), mode:'deepseek'});
  } catch (e) {
    return send(502, {error:e.name === 'TimeoutError' ? 'DeepSeek 回答超时' : e.message});
  }
}

module.exports = handler;
module.exports._test = {readBody, classify};
