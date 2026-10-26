const assert=require('node:assert/strict');const {computeGrid}=require('../density-worker');const t=require('../api/amap-roads')._test;
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),tileCode=html.match(/function roadTilesForBounds\(bbox\)\{[\s\S]*?\n\}(?=\nfunction setRoadFeatures)/)?.[0];assert(tileCode,'road tiling function exists');
const roadTilesForBounds=vm.runInNewContext(`const ROAD_TILE_LON_STEP=.05,ROAD_TILE_LAT_STEP=.04,ROAD_TILE_LIMIT=20;${tileCode};roadTilesForBounds`);
const first=roadTilesForBounds([118.72,31.95,118.86,32.05]),panned=roadTilesForBounds([118.76,31.95,118.90,32.05]);
assert(first.length>1&&first.length<=20);assert(first.some(a=>panned.some(b=>JSON.stringify(a)===JSON.stringify(b))),'panned view reuses stable tiles');
first.forEach(b=>assert(t.parseBounds(b.map(x=>x.toFixed(6)).join(','))));
assert.throws(()=>roadTilesForBounds([118,31,119,32]),/超过单次上限/);
const p=[118.76,32],q=t.wgsToGcj(p),back=t.gcjToWgs(q);assert(Math.abs(q[0]-p[0])>.001);assert(Math.abs(back[0]-p[0])<1e-7&&Math.abs(back[1]-p[1])<1e-7);assert.throws(()=>t.parseBounds('118,32,119,33'),/9 公里/);assert.throws(()=>t.parseBounds('118,32,117,31'));assert.equal(t.toGeoJSON({trafficinfo:{roads:[{name:'测试路',polyline:q.join(',')+';'+[q[0]+.001,q[1]+.001].join(',')},{name:'坏路',polyline:'bad'}]}}).features.length,1);
const kx=6378137*Math.PI/180*Math.cos(32*Math.PI/180),ky=6378137*Math.PI/180;
const bounds=[118.76,32,118.76+500/kx,32+500/ky];const grid=computeGrid({centers:[[118.76+250/kx,32+250/ky],[118.76+250/kx,32+250/ky]],bounds,cellSize:5,radius:100});assert.equal(grid.cellSize,5);assert.equal(grid.max,2);assert(Math.abs(grid.width-100)<=1&&Math.abs(grid.height-100)<=1);const pix=new Uint8ClampedArray(grid.pixels);assert.equal(pix[3],0);assert(pix.some((v,i)=>i%4===3&&v===225));assert.equal(grid.corners[0][1],bounds[3]);assert(grid.corners[2][1]<bounds[3]);assert.throws(()=>computeGrid({centers:[p],bounds:[118,32,119,33]}),/100 万/);assert.throws(()=>computeGrid({centers:[p],bounds,cellSize:10}),/参数/);
console.log('PASS: 5m spacing, local density peak, no-data transparency, north-up georeference, raster size guard, coordinate roundtrip, road validation and conversion');

