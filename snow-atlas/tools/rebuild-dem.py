"""Rebuild the exact selected OSM fragments from saved evidence, using real DEM tiles.
Run from any directory: python tools/rebuild-dem.py
Requires: pip install requests Pillow
Does not refresh OSM; updates only existing selected features. Network downloads are cached.
"""
import io,json,math
from pathlib import Path
import requests
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'data'/'dem-cache';CACHE.mkdir(exist_ok=True)
session=requests.Session();session.headers['User-Agent']='SnowAtlasMVP/1.0'
def distance(a,b):
    p,q=math.radians(a[1]),math.radians(b[1])
    return 6371000*2*math.asin(min(1,math.sqrt(math.sin((q-p)/2)**2+math.cos(p)*math.cos(q)*math.sin(math.radians(b[0]-a[0])/2)**2)))
tiles={}
def elevation(p):
    n=4096;x=(p[0]+180)/360*n;y=(1-math.asinh(math.tan(math.radians(p[1])))/math.pi)/2*n;key=(int(x),int(y))
    if key not in tiles:
        dest=CACHE/f'12-{key[0]}-{key[1]}.png'
        if not dest.exists():
            response=session.get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/{key[0]}/{key[1]}.png',timeout=60);response.raise_for_status();dest.write_bytes(response.content)
        tiles[key]=Image.open(dest).convert('RGB')
    r,g,b=tiles[key].getpixel((min(255,int(x%1*256)),min(255,int(y%1*256))))
    return r*256+g+b/256-32768
terrain=json.loads((ROOT/'terrain.json').read_text(encoding='utf8'))
for resort in terrain:
    for feature in resort['features']:
        coords=feature['geometry']['coordinates'];points=[coords[0]]
        length=sum(distance(a,b) for a,b in zip(coords,coords[1:]))
        for a,b in zip(coords,coords[1:]):
            steps=max(1,math.ceil(distance(a,b)/35))
            points.extend([[a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps] for k in range(1,steps+1)])
        profile=[];travel=0
        for i,p in enumerate(points):
            if i:travel+=distance(points[i-1],p)
            profile.append([round(travel,1),round(elevation(p),1)])
        windows=[]
        for i,a in enumerate(profile):
            b=next((b for b in profile[i+1:] if b[0]-a[0]>=100),None)
            if b:windows.append(math.degrees(math.atan(abs(b[1]-a[1])/(b[0]-a[0]))))
        feature['properties'].update(profile=profile,length=round(length),demStatus='available',netSlope=round(math.degrees(math.atan(abs(profile[-1][1]-profile[0][1])/length)),1),max100mSlope=round(max(windows),1) if windows else None)
(ROOT/'terrain.rebuilt.json').write_text(json.dumps(terrain,ensure_ascii=False),encoding='utf8')
print('Saved terrain.rebuilt.json; original terrain.json preserved.')
