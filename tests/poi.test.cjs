const assert=require('node:assert/strict');
const {parse,search}=require('../api/amap-poi')._test;
(async()=>{
 const input={point:[121.46,31.23],radius:100,page:1};
 const request=async url=>{assert.equal(url.searchParams.get('offset'),'20');return{ok:true,json:async()=>({status:'1',count:'24',pois:Array.from({length:20},(_,i)=>({id:String(i),name:'地点'+i,location:'121.46,31.23'}))})}};
 const first=await search(input,'test-key',request);
 assert.equal(first.pois.length,20);
 assert.equal(first.hasMore,true,'A second page is needed when Amap returns 20 of 24 records');
 assert.throws(()=>parse(new URLSearchParams('center=121.46,31.23&radius=100&page=11')),/最多查询 10 页/);
 const elder=parse(new URLSearchParams('center=121.46,31.23&radius=2000&kind=elder_daycare'));
 await search(elder,'test-key',async url=>{
   assert.match(url.searchParams.get('keywords'),/日间照料/);
   assert.equal(url.searchParams.has('types'),false);
   return {ok:true,json:async()=>({status:'1',count:'0',pois:[]})};
 });
 assert.throws(()=>parse(new URLSearchParams('center=121.46,31.23&radius=2000&kind=apartment')),/不支持的设施类别/);
 console.log('PASS Amap POI pagination, query cap and allowed facility searches');
})().catch(e=>{console.error(e);process.exitCode=1});
