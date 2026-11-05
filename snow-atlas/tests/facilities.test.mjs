import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const root=new URL('../',import.meta.url),resorts=JSON.parse(fs.readFileSync(new URL('resorts.json',root)));
test('all facility inventories have traceable OSM identities, tags, bounded coordinates and honest acquisition status',()=>{
 for(const r of resorts){const d=JSON.parse(fs.readFileSync(new URL(`facilities/${r.id}.json`,root)));assert.equal(d.resortId,r.id);assert.ok(['available','unavailable'].includes(d.status));assert.ok(d.retrievedAt&&d.coverageNote);const[w,s,e,n]=d.bounds;const ids=new Set();for(const f of d.features){assert.ok(!ids.has(f.id));ids.add(f.id);assert.equal(f.source,'https://www.openstreetmap.org/'+f.id);assert.ok(f.tags.amenity||f.tags.shop);assert.ok(f.coordinates[0]>=w&&f.coordinates[0]<=e&&f.coordinates[1]>=s&&f.coordinates[1]<=n);assert.ok(f.name&&['cafe','food','shop'].includes(f.kind))}if(d.status==='unavailable')assert.equal(d.features.length,0)}
});
