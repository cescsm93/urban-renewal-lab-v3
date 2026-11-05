from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import requests,json,math,time,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
resorts=json.loads((ROOT/'resorts.json').read_text(encoding='utf8'))
def get(r):
 id=r['id']
 if (ROOT/'models'/f'{id}.json').exists() and json.loads((ROOT/'models'/f'{id}.json').read_text(encoding='utf8'))['routes']['features']:return
 dest=ROOT/'data'/f'{id}-osm.json'
 if not dest.exists() or not json.loads(dest.read_text(encoding='utf8')).get('elements'):
  dy=5000/111320;dx=dy/math.cos(math.radians(r['lat']))
  box=[r['lat']-dy,r['lon']-dx,r['lat']+dy,r['lon']+dx]
  query=f'[out:json][timeout:25];way["piste:type"="downhill"]({",".join(map(str,box))});out tags geom;'
  data=None
  hosts=['https://maps.mail.ru/osm/tools/overpass/api/interpreter','https://overpass.private.coffee/api/interpreter']
  if r.get('region')=='欧洲':hosts.insert(0,'https://ovp.dresel.systems/api/interpreter')
  if r.get('country')=='瑞士':hosts.insert(0,'https://overpass.osm.ch/api/interpreter')
  for host in hosts:
   try:
    resp=requests.get(host,params={'data':query},timeout=40,headers={'User-Agent':'SnowAtlasMVP/1.0 (source-attributed ski atlas; https://urban-renewal-lab-1.vercel.app/snow-atlas/)'});resp.raise_for_status();data=resp.json()
    if 'elements' not in data or data.get('remark'):raise ValueError('incomplete response')
    data.update(retrievedAt='2026-11-05',query=query,endpoint=host,queryRadiusMetres=5000)
    break
   except Exception as e: data=None;print(id,'source retry',type(e).__name__,flush=True)
  if data is None:data={'elements':[],'retrievedAt':'2026-11-05','query':query,'acquisitionError':'两处公开线路服务未成功响应，线路待补充'}
  dest.write_text(json.dumps(data,ensure_ascii=False),encoding='utf8')
 result=subprocess.run([sys.executable,str(ROOT/'tools/build-models.py'),id],capture_output=True,text=True,encoding='utf8',errors='replace')
 print(result.stdout or (id+' FAILED '+result.stderr[-350:]),flush=True)
with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(get,resorts))


