const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {validateInput, normalizeIntent, answer} = require('../lib/copilot-core.cjs');
const handler = require('../api/copilot.js');

const resources = [
  {index:0,name:'东部居住更新资源',type:'老旧小区',category:'residential',areaHa:12.5,inView:true,inFilter:true},
  {index:1,name:'西部居住更新资源',type:'城中村',category:'residential',areaHa:18.2,inView:false,inFilter:true},
  {index:2,name:'产业资源',type:'老旧厂区',category:'industrial',areaHa:30,inView:true,inFilter:false}
];
const input = validateInput({question:'最大的居住资源在哪里？',resources});
assert.deepEqual(normalizeIntent('{"metric":"largest","scope":"all","category":"residential"}'),
  {metric:'largest',scope:'all',category:'residential',searchText:''});
const largest = answer(input,{metric:'largest',scope:'all',category:'residential'});
assert.equal(largest.index,1);
assert.match(largest.text,/18\.200 公顷/);
assert.match(answer(input,{metric:'count',scope:'view',category:null}).text,/共 2 处/);
assert.match(answer(input,{metric:'area',scope:'filter',category:null}).text,/30\.700 公顷/);
assert.throws(()=>validateInput({question:'问题',resources:[{...resources[0],areaHa:Infinity}]}),/无效/);

async function invoke(body, extraHeaders = {}) {
  const req = {method:'POST',body,headers:{'x-forwarded-for':'198.51.100.44',...extraHeaders}};
  const headers = {};
  const res = {statusCode:200,setHeader:(key,value)=>{headers[key]=value},end(value){this.body=JSON.parse(value)}};
  await handler(req,res);
  return res;
}

(async()=>{
  const originalKey = process.env.VERCEL;
  const originalEnabled = process.env.COPILOT_AI_ENABLED;
  const originalFetch = global.fetch;
  const configNames = ['QWEN_BRIDGE_URL', 'QWEN_BRIDGE_TOKEN', 'QWEN_ACCESS_CODE_SHA256'];
  const originalConfig = Object.fromEntries(configNames.map(key => [key, process.env[key]]));
  configNames.forEach(key => delete process.env[key]);
  try {
    process.env.COPILOT_AI_ENABLED = 'true';
    process.env.VERCEL='1';
    assert.equal((await invoke({question:'有多少资源？',resources})).statusCode,503);
    delete process.env.VERCEL;
    global.fetch = async (url, options) => {
      assert.equal(url,'http://127.0.0.1:11434/api/chat');
      const sent = JSON.parse(options.body);
      assert.equal(sent.model,'qwen2.5:7b-instruct-q4_K_M');
      assert.ok(!options.body.includes('完整边界'));
      return {ok:true,json:async()=>({message:{content:'{"metric":"largest","scope":"all","category":"residential"}'}})};
    };
    const result = await invoke({question:'最大的居住资源在哪里？',resources});
    assert.equal(result.statusCode,200);
    assert.equal(result.body.mode,'ollama');
    assert.equal(result.body.index,1);
    process.env.VERCEL = '1';
    process.env.QWEN_BRIDGE_URL = 'https://relay.example';
    process.env.QWEN_BRIDGE_TOKEN = 'test-relay-token';
    process.env.QWEN_ACCESS_CODE_SHA256 = createHash('sha256').update('test-access-code').digest('hex');
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(url.href, 'https://relay.example/classify');
      assert.equal(options.headers.Authorization, 'Bearer test-relay-token');
      assert.deepEqual(JSON.parse(options.body), { question: input.question });
      return { ok: true, json: async () => ({ intent: { metric: 'largest', category: 'residential' } }) };
    };
    assert.equal((await invoke(input)).statusCode, 401);
    assert.equal((await invoke(input, {'x-qwen-access-code':'wrong'})).statusCode, 401);
    assert.equal(calls, 0);
    const online = await invoke(input, {'x-qwen-access-code':'test-access-code'});
    assert.equal(online.statusCode, 200);
    assert.equal(online.body.mode, 'ollama-online');
    assert.equal(online.body.index, 1);
    assert.equal(calls, 1);
    console.log('PASS Copilot intent, GIS facts, local Ollama, online access gate and question-only bridge');
  } finally {
    if (originalKey === undefined) delete process.env.VERCEL;
    else process.env.VERCEL=originalKey;
    if (originalEnabled === undefined) delete process.env.COPILOT_AI_ENABLED;
    else process.env.COPILOT_AI_ENABLED=originalEnabled;
    for (const key of configNames) {
      if (originalConfig[key] === undefined) delete process.env[key];
      else process.env[key] = originalConfig[key];
    }
    global.fetch=originalFetch;
  }
})().catch(error=>{console.error(error);process.exitCode=1});
