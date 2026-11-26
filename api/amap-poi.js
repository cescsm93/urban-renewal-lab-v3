const {wgsToGcj,gcjToWgs}=require('./amap-roads')._test;
const {take}=require('../lib/usage-guard.cjs');
const {methods}=require('../lib/program-analysis.js');
const PAGE_SIZE=20,MAX_PAGES=10;
function categoryOf(p){const type=String(p.type||'');const code=String(p.typecode||'');
  if(/地铁|轨道交通|轻轨/.test(type))return '地铁站';
  if(/公交|公共汽车/.test(type))return '公交站';
  if(code.startsWith('05')||/餐饮|饭店|餐厅|小吃|咖啡|茶馆/.test(type))return '餐饮';
  if(code.startsWith('06')||/购物|商场|商店|超市|市场/.test(type))return '购物商业';
  if(code.startsWith('09')||/医疗|医院|诊所|药店/.test(type))return '医疗';
  if(code.startsWith('14')||/学校|教育|科教|培训/.test(type))return '教育文化';
  if(code.startsWith('11')||/公园|景区|风景名胜|体育|运动/.test(type))return '公园文体';
  if(code.startsWith('15')||/交通设施|火车站|汽车站|停车场/.test(type))return '交通其他';
  if(code.startsWith('13')||/政府机构|公共设施|社会团体/.test(type))return '公共服务';
  if(code.startsWith('10')||/住宿|酒店|宾馆/.test(type))return '住宿';
  return '其他';}
const nearbyTypes = {'地铁站':'150500','公交站':'150700','餐饮':'050000','购物':'060000','医疗':'090000','教育文化':'140000','景点':'110000'};
const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=72.004&&p[0]<=137.8347&&p[1]>=.8293&&p[1]<=55.8271;
function parse(query){const point=String(query.get('center')||'').split(',').map(Number),radius=Number(query.get('radius')),page=Number(query.get('page')||1);if(!valid(point)||!Number.isInteger(radius)||radius<100||radius>5000||!Number.isInteger(page)||page<1||page>MAX_PAGES)throw Error('中心点、半径或页码无效；半径须为 100～5000 米，最多查询 10 页');const category=query.get('category');if(category){if(!Object.hasOwn(nearbyTypes,category))throw Error('不支持的 POI 类别');return {point,radius,page,types:nearbyTypes[category]}}const kind=query.get('kind');if(kind!==null){if(!Object.hasOwn(methods,kind)||!methods[kind].keywords)throw Error('不支持的设施类别');return{point,radius,page,keywords:methods[kind].keywords}}return query.get('publicOnly')==='1'?{point,radius,page,publicOnly:true}:{point,radius,page}}
async function search({point,radius,page,publicOnly,keywords,types},key,request=fetch){const center=wgsToGcj(point);const url=new URL('https://restapi.amap.com/v3/place/around');url.search=new URLSearchParams({key,location:center.map(n=>n.toFixed(6)).join(','),radius:String(radius),sortrule:'distance',offset:String(PAGE_SIZE),page:String(page),extensions:'base',output:'JSON'}).toString();if(types)url.searchParams.set('types',types);else if(keywords)url.searchParams.set('keywords',keywords);else if(publicOnly)url.searchParams.set('types','090000|140000|110100');const response=await request(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('高德服务暂不可用');const data=await response.json();if(data.status!=='1')throw Error('高德返回 '+String(data.info||'未知错误'));const pois=(data.pois||[]).map(p=>{const gcj=String(p.location||'').split(',').map(Number);if(!valid(gcj))return null;const point=gcjToWgs(gcj);return{id:String(p.id||''),name:String(p.name||'未命名地点').slice(0,120),type:String(p.type||'未分类').slice(0,120),category:categoryOf(p),address:String(p.address||'').slice(0,200),distance:Number(p.distance)||0,point}}).filter(Boolean);return{pois,total:Number(data.count)||0,page,radius,hasMore:page<MAX_PAGES&&page*PAGE_SIZE<(Number(data.count)||0)&&pois.length>0,limited:page===MAX_PAGES&&page*PAGE_SIZE<(Number(data.count)||0)}}
async function handler(req,res){const send=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data))};if(req.method!=='GET')return send(405,{error:'仅支持 GET'});let query;try{query=parse(new URL(req.url,'http://localhost').searchParams)}catch(e){return send(400,{error:e.message})}const key=process.env.AMAP_WEB_KEY;if(!key)return send(503,{error:'服务端尚未配置高德 Web 服务 Key'});const quota=take(req,'poi');if(!quota.allowed){res.setHeader('Retry-After',String(quota.retryAfter));return send(429,{error:'POI 查询次数已达保护上限，请稍后重试'})}try{return send(200,await search(query,key))}catch(e){return send(502,{error:e.name==='TimeoutError'?'高德请求超时':e.message})}}
module.exports=handler;module.exports._test={parse,search,categoryOf};
