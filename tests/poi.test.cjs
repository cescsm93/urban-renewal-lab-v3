const assert=require('node:assert/strict');
const {parse,search}=require('../api/amap-poi')._test;
(async()=>{
 const input={point:[121.46,31.23],radius:100,page:1};
 const request=async url=>{assert.equal(url.searchParams.get('offset'),'20');return{ok:true,json:async()=>({status:'1',count:'24',pois:Array.from({length:20},(_,i)=>({id:String(i),name:'地点'+i,location:'121.46,31.23'}))})}};
 const first=await search(input,'test-key',request);
 assert.equal(first.pois.length,20);
 assert.equal(first.hasMore,true,'A second page is needed when Amap returns 20 of 24 records');
 assert.throws(()=>parse(new URLSearchParams('center=121.46,31.23&radius=100&page=11')),/最多查询 10 页/);
 console.log('PASS Amap POI 20-item pagination and 200-item query cap');
})().catch(e=>{console.error(e);process.exitCode=1});
