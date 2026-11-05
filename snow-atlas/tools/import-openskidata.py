from pathlib import Path
import json,ijson,math,subprocess,sys
p=Path(__file__).resolve().parents[1];rs=json.loads((p/'resorts.json').read_text(encoding='utf8'))
targets=[]
for r in rs:
 f=p/'models'/f'{r["id"]}.json'
 if not f.exists() or not json.loads(f.read_text(encoding='utf8'))['routes']['features']:
  dy=5000/111320;dx=dy/math.cos(math.radians(r['lat']));r['box']=[r['lon']-dx,r['lat']-dy,r['lon']+dx,r['lat']+dy];r['features']=[];targets.append(r)
with (Path(__file__).resolve().parents[1]/'data'/'runs.geojson').open('rb') as f:
 for feat in ijson.items(f,'features.item',use_float=True):
  prop=feat['properties'];g=feat['geometry']
  if g['type']!='LineString' or 'downhill' not in prop.get('uses',[]) or prop.get('status')!='operating':continue
  src=[s['id'] for s in prop.get('sources',[]) if s['type']=='openstreetmap' and s['id'].startswith('way/')]
  if not src:continue
  coords=g['coordinates']
  for r in targets:
   w,s,e,n=r['box']
   if any(w<=c[0]<=e and s<=c[1]<=n for c in coords):r['features'].append(feat)
for r in targets:
 id=r['id'];features=r['features'];raw={'type':'FeatureCollection','source':'https://tiles.openskimap.org/geojson/runs.geojson','retrievedAt':'2026-11-05','features':features}
 (p/'data'/f'{id}-openskidata.json').write_text(json.dumps(raw,ensure_ascii=False),encoding='utf8')
 ways=[]
 for f in features:
  q=f['properties'];src=[s['id'] for s in q['sources'] if s['type']=='openstreetmap' and s['id'].startswith('way/')]
  ways.append({'type':'way','id':int(src[0].split('/')[1]),'geometry':[{'lon':c[0],'lat':c[1]} for c in f['geometry']['coordinates']],'tags':{'piste:type':'downhill','name':q.get('name') or q.get('ref') or 'OSM '+src[0],'piste:difficulty':q.get('difficulty') or 'unknown'},'openSkiDataFeatureId':q['id'],'sourceIds':src})
 evidence={'elements':ways,'retrievedAt':'2026-11-05','derivedFrom':'OpenSkiData','endpoint':raw['source'],'rawEvidence':f'data/{id}-openskidata.json','queryBounds':r['box'],'note':'XY coordinates preserved from OpenSkiData processed OSM features; not raw Overpass output.'}
 (p/'data'/f'{id}-osm.json').write_text(json.dumps(evidence,ensure_ascii=False),encoding='utf8')
 result=subprocess.run([sys.executable,str(p/'tools/build-models.py'),id],capture_output=True,text=True,encoding='utf8',errors='replace');print(result.stdout or result.stderr[-200:],flush=True)
