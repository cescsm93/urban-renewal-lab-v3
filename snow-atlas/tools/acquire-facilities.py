from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import requests,json,xml.etree.ElementTree as ET,time
p=Path(__file__).resolve().parents[1];out=p/'facilities';out.mkdir(exist_ok=True)
rs=json.loads((p/'resorts.json').read_text(encoding='utf8'))
def collect(r):
 dest=out/(r['id']+'.json')
 if dest.exists() and json.loads(dest.read_text(encoding='utf8'))['status']=='available':return
 m=json.loads((p/'models'/(r['id']+'.json')).read_text(encoding='utf8'));w,s,e,n=m['bounds']
 # Bounded base-area inventory, not an inferred resort ownership boundary.
 w=max(w,r['lon']-.025);e=min(e,r['lon']+.025);s=max(s,r['lat']-.02);n=min(n,r['lat']+.02)
 result={'resortId':r['id'],'retrievedAt':'2026-11-05','bounds':[w,s,e,n],'features':[],'coverageNote':'模型与概略位置附近约2公里范围的公开设施；可能包含周边商户，不代表雪场自营、完整目录或营业状态。','status':'unavailable'}
 url='https://api.openstreetmap.org/api/0.6/map'
 try:
  root=ET.Element('osm');seen=set();result['queryUrls']=[]
  def fetchbox(box,depth=0):
   resp=requests.get(url,params={'bbox':','.join(map(str,box))},headers={'User-Agent':'SnowAtlas/1.0 source-attributed facilities'},timeout=25)
   if resp.status_code==400 and depth<3:
    a,b,c,d=box;x=(a+c)/2;y=(b+d)/2
    for sub in [[a,b,x,y],[x,b,c,y],[a,y,x,d],[x,y,c,d]]:fetchbox(sub,depth+1)
   else:
    resp.raise_for_status();result['queryUrls'].append(resp.url)
    for el in ET.fromstring(resp.content):
     key=(el.tag,el.get('id'))
     if key not in seen:root.append(el);seen.add(key)
  fetchbox([w,s,e,n])
  nodes={a.attrib['id']:[float(a.attrib['lon']),float(a.attrib['lat'])] for a in root.findall('node')}
  for a in list(root.findall('node'))+list(root.findall('way')):
   tags={t.attrib['k']:t.attrib['v'] for t in a.findall('tag')};amenity=tags.get('amenity');shop=tags.get('shop')
   if amenity not in ['cafe','restaurant','fast_food','bar','pub'] and not shop:continue
   if shop in ['vacant','no']:continue
   coords=nodes.get(a.attrib['id']) if a.tag=='node' else None
   if a.tag=='way':
    pts=[nodes[t.attrib['ref']] for t in a.findall('nd') if t.attrib['ref'] in nodes]
    if pts:coords=[sum(t[k] for t in pts)/len(pts) for k in [0,1]]
   if not coords or not(w<=coords[0]<=e and s<=coords[1]<=n):continue
   kind='cafe' if amenity=='cafe' else 'shop' if shop else 'food'
   result['features'].append({'id':a.tag+'/'+a.attrib['id'],'name':tags.get('name:zh') or tags.get('name') or {'cafe':'未命名咖啡店','shop':'未命名商店','food':'未命名餐饮'}[kind],'kind':kind,'coordinates':coords,'positionMethod':'OSM node' if a.tag=='node' else 'mapped building vertex mean (approximate)','tags':tags,'source':'https://www.openstreetmap.org/'+a.tag+'/'+a.attrib['id']})
  result['status']='available';result['queryUrl']=result['queryUrls'][0]
 except Exception as ex:result['error']='公开设施数据暂未取得；不生成替代商户';print(r['id'],type(ex).__name__,flush=True)
 dest.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf8');print(r['id'],len(result['features']),result['status'],flush=True)
with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(collect,rs))
