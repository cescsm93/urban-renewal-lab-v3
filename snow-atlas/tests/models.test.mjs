import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const resorts=JSON.parse(fs.readFileSync(new URL('resorts.json',root),'utf8'));
for(const {id} of resorts)test(`${id}: real terrain grid and OSM geometry provenance`,()=>{
  const model=JSON.parse(fs.readFileSync(new URL(`models/${id}.json`,root),'utf8'));
  const raw=JSON.parse(fs.readFileSync(new URL(`data/${id}-osm.json`,root),'utf8'));
  assert.equal(model.resortId,id);
  assert.equal(model.elevations.length,model.width*model.height);
  assert.ok(model.width>=100&&model.height>=100);
  assert.equal(model.rowOrder,'north-to-south');
  assert.equal(model.columnOrder,'west-to-east');
  assert.ok(model.elevations.every(v=>Number.isFinite(v)&&v>-500&&v<9000));
  assert.ok(Math.max(...model.elevations)>Math.min(...model.elevations));
  const [w,s,e,n]=model.bounds;assert.ok(w<e&&s<n);
  const expected=raw.elements.filter(x=>x.type==='way'&&x.tags?.['piste:type']==='downhill'&&x.tags?.area!=='yes'&&x.geometry?.length>=2);
  assert.equal(model.routes.features.length,expected.length);
  if(!expected.length)assert.match(model.coverageNote,/暂缺/);
  const snapshot=raw.derivedFrom==='OpenSkiData'?JSON.parse(fs.readFileSync(new URL(raw.rawEvidence,root),'utf8')):null;
  for(const feature of model.routes.features){
    const original=expected.find(x=>raw.derivedFrom==='OpenSkiData'?x.openSkiDataFeatureId===feature.properties.openSkiDataFeatureId:x.id===feature.properties.osmId);assert.ok(original);
    assert.deepEqual(feature.geometry.coordinates,original.geometry.map(p=>[p.lon,p.lat]));
    assert.ok(feature.geometry.coordinates.every(([lon,lat])=>lon>=w&&lon<=e&&lat>=s&&lat<=n));
    assert.equal(feature.properties.source,`https://www.openstreetmap.org/way/${original.id}`);
    if(raw.derivedFrom==='OpenSkiData'){
      const source=snapshot.features.find(f=>f.properties.id===feature.properties.openSkiDataFeatureId);
      assert.ok(source,'raw upstream feature exists');
      assert.deepEqual(feature.geometry.coordinates,source.geometry.coordinates.map(c=>c.slice(0,2)));
      assert.ok(model.sources.some(s=>s.url==='https://openskidata.org/'));
    }
  }
  assert.ok(model.sources.some(source=>source.tiles?.length>0));
});

