const assert = require('node:assert/strict');
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

async function invoke(body) {
  const req = {method:'POST',body,headers:{'x-forwarded-for':'198.51.100.44'}};
  const headers = {};
  const res = {statusCode:200,setHeader:(key,value)=>{headers[key]=value},end(value){this.body=JSON.parse(value)}};
  await handler(req,res);
  return res;
}

(async()=>{
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalEnabled = process.env.COPILOT_AI_ENABLED;
  const originalFetch = global.fetch;
  try {
    process.env.COPILOT_AI_ENABLED = 'true';
    delete process.env.DEEPSEEK_API_KEY;
    assert.equal((await invoke({question:'有多少资源？',resources})).statusCode,503);
    process.env.DEEPSEEK_API_KEY = 'mock-key';
    global.fetch = async (url, options) => {
      assert.equal(url,'https://api.deepseek.com/chat/completions');
      assert.equal(options.headers.Authorization,'Bearer mock-key');
      const sent = JSON.parse(options.body);
      assert.equal(sent.model,'deepseek-flash');
      assert.ok(!options.body.includes('完整边界'));
      return {ok:true,json:async()=>({choices:[{message:{content:'{"metric":"largest","scope":"all","category":"residential"}'}}]})};
    };
    const result = await invoke({question:'最大的居住资源在哪里？',resources});
    assert.equal(result.statusCode,200);
    assert.equal(result.body.mode,'deepseek');
    assert.equal(result.body.index,1);
    console.log('PASS Copilot intent, deterministic GIS facts, missing-key fallback and mocked DeepSeek request');
  } finally {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY=originalKey;
    if (originalEnabled === undefined) delete process.env.COPILOT_AI_ENABLED;
    else process.env.COPILOT_AI_ENABLED=originalEnabled;
    global.fetch=originalFetch;
  }
})().catch(error=>{console.error(error);process.exitCode=1});
