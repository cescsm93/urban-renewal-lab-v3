"""Build real terrain grids and community-mapped pistes from saved OSM evidence.

Run: python tools/build-models.py
Dependencies: pip install requests Pillow
No procedural/fabricated terrain is used. Terrain heights are bilinearly sampled
from historical Mapzen Terrarium DEM tiles at zoom 12. Saved OSM queries are
bounded evidence snapshots, not the full official resort piste inventory.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json, math, time, sys
import requests
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'models'; OUT.mkdir(exist_ok=True)
CACHE=ROOT/'data'/'dem-cache'; CACHE.mkdir(exist_ok=True)
ZOOM=12
WIDTH=128
HEIGHT=128
tiles={}

def tilepos(lon,lat):
    n=2**ZOOM
    return ((lon+180)/360*n, (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)

def fetch_tile(key):
    x,y=key
    dest=CACHE/f'{ZOOM}-{x}-{y}.png'
    url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png'
    if not dest.exists():
        last=None
        for attempt in range(3):
            try:
                response=requests.get(url,timeout=45,headers={'User-Agent':'SnowAtlasMVP/1.0 terrain research'})
                response.raise_for_status()
                image=Image.open(__import__('io').BytesIO(response.content));image.verify()
                dest.write_bytes(response.content)
                break
            except Exception as error:
                last=error
                if attempt==2: raise
                time.sleep(attempt+1)
    return key,Image.open(dest).convert('RGB'),url

def pixel_elevation(x,y):
    tx,px=divmod(x,256);ty,py=divmod(y,256)
    r,g,b=tiles[(tx,ty)].getpixel((px,py))
    return r*256+g+b/256-32768

def elevation(lon,lat):
    tx,ty=tilepos(lon,lat)
    # Pixel centers represent DEM samples. Linear interpolation is derived from
    # four real neighboring samples; it does not add measured resolution.
    gx,gy=tx*256-.5,ty*256-.5
    ix,iy=math.floor(gx),math.floor(gy);fx,fy=gx-ix,gy-iy
    a=pixel_elevation(ix,iy);b=pixel_elevation(ix+1,iy)
    c=pixel_elevation(ix,iy+1);d=pixel_elevation(ix+1,iy+1)
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy

for resort_id in (sys.argv[1:] or ['zermatt','niseko','whistler']):
    evidence=json.loads((ROOT/'data'/f'{resort_id}-osm.json').read_text(encoding='utf8'))
    ways=[w for w in evidence['elements'] if w.get('type')=='way'
          and w.get('tags',{}).get('piste:type')=='downhill'
          and w.get('tags',{}).get('area')!='yes'
          and len(w.get('geometry',[]))>=2]
    all_points=[p for w in ways for p in w['geometry']]
    if all_points:
        west=min(p['lon'] for p in all_points); east=max(p['lon'] for p in all_points)
        south=min(p['lat'] for p in all_points); north=max(p['lat'] for p in all_points)
    else:
        resort=next(r for r in json.loads((ROOT/'resorts.json').read_text(encoding='utf8')) if r['id']==resort_id)
        dy=5000/111320;dx=dy/math.cos(math.radians(resort['lat']))
        west=resort['lon']-dx;east=resort['lon']+dx;south=resort['lat']-dy;north=resort['lat']+dy
    lat_mid=(north+south)/2
    dx=150/(111320*math.cos(math.radians(lat_mid)));dy=150/111320
    west-=dx;east+=dx;south-=dy;north+=dy
    # Download the few real DEM tiles intersecting bounds, including one-pixel
    # neighbors used by bilinear interpolation.
    left,top=tilepos(west,north);right,bottom=tilepos(east,south)
    keys=[(x,y) for x in range(math.floor(left-1/256),math.floor(right+1/256)+1)
          for y in range(math.floor(top-1/256),math.floor(bottom+1/256)+1)]
    tile_urls=[]
    with ThreadPoolExecutor(max_workers=5) as pool:
        for key,image,url in pool.map(fetch_tile,keys):
            tiles[key]=image;tile_urls.append(url)
    heights=[]
    for row in range(HEIGHT):
        lat=north-(north-south)*row/(HEIGHT-1)
        for column in range(WIDTH):
            lon=west+(east-west)*column/(WIDTH-1)
            heights.append(round(elevation(lon,lat),1))
    features=[]
    for way in ways:
        tags=way.get('tags',{})
        route_name=tags.get('piste:name') or tags.get('name') or ('OSM '+str(way['id']))
        coords=[[p['lon'],p['lat']] for p in way['geometry']]
        features.append({'type':'Feature','geometry':{'type':'LineString','coordinates':coords},
            'properties':{'osmId':way['id'],'name':route_name,'difficulty':tags.get('piste:difficulty','unknown'),
                'ref':tags.get('piste:ref') or tags.get('ref'),'tags':tags,
                'source':f'https://www.openstreetmap.org/way/{way["id"]}',
                'openSkiDataFeatureId':way.get('openSkiDataFeatureId'),
                'sourceUrls':['https://www.openstreetmap.org/'+s for s in way.get('sourceIds',[]) ]}})
    grid_dx=(east-west)*111320*math.cos(math.radians(lat_mid))/(WIDTH-1)
    grid_dy=(north-south)*111320/(HEIGHT-1)
    output={'resortId':resort_id,'bounds':[west,south,east,north],'width':WIDTH,'height':HEIGHT,
        'elevations':heights,'elevationUnit':'metres','rowOrder':'north-to-south','columnOrder':'west-to-east',
        'verticalExaggeration':1,'gridSpacingMetres':[round(grid_dx,1),round(grid_dy,1)],
        'demZoom':ZOOM,'interpolation':'bilinear interpolation of real Terrarium pixel-center elevations',
        'elevationRange':[min(heights),max(heights)],'routes':{'type':'FeatureCollection','features':features},
        'retrievedAt':evidence.get('retrievedAt','2026-11-04'),'demAcquiredAt':time.strftime('%Y-%m-%d'),'demDataDate':'historical multi-source DEM; source dates vary',
        'coverageNote':'社区映射的已采集范围内雪道片段，非完整官方雪场模型；无缆车、建筑或实时雪面实测。',
        'coverageEnglish':'All non-area downhill ways in the saved bounded OSM response; not a complete official resort model.',
        'sources':[{'title':'OpenStreetMap contributors, ODbL','url':'https://www.openstreetmap.org/copyright',
                    'evidence':f'data/{resort_id}-osm.json','timestampOsmBase':evidence.get('osm3s',{}).get('timestamp_osm_base')},
                   {'title':'Mapzen Terrain Tiles on AWS','url':'https://registry.opendata.aws/terrain-tiles/',
                    'attributionUrl':'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
                    'encodingUrl':'https://github.com/tilezen/joerd/blob/master/docs/formats.md','tiles':tile_urls}]}
    if evidence.get('derivedFrom')=='OpenSkiData':
        output['sources'].append({'title':'OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL), Skimap.org, Who’s On First, © Mapterhorn','url':'https://openskidata.org/','downloadUrl':evidence['endpoint'],'evidence':evidence['rawEvidence']})
    if not features:output['coverageNote']='真实 DEM 地形；线路资料暂缺。'+evidence.get('acquisitionError','周边5公里未找到公开映射的 downhill 线路。')+' 未生成替代线路。'
    else:output['coverageNote']='概略位置周边检索所得 OSM 社区线路片段，可能含相邻雪区；非官方完整名录、边界或开放状态。每条线可查原始 OSM 依据。'
    if evidence.get('derivedFrom')=='OpenSkiData':output['coverageNote']+=' 线路由 OpenSkiData / OpenSkiMap.org 整理，保留其原始平面坐标；© OpenStreetMap contributors (ODbL), Skimap.org, Who’s On First, © Mapterhorn。'
    assert len(heights)==WIDTH*HEIGHT and max(heights)>min(heights)
    assert all(math.isfinite(v) and -500<v<9000 for v in heights)
    (OUT/f'{resort_id}.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(resort_id,len(features),'real OSM fragments;',output['elevationRange'],'m;',output['gridSpacingMetres'],'m grid',flush=True)
