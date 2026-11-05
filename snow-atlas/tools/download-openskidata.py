import requests,time
from pathlib import Path
p=(Path(__file__).resolve().parents[1]/'data'/'runs.geojson')
if not p.exists():
 with requests.get('https://tiles.openskimap.org/geojson/runs.geojson',stream=True,timeout=60) as r:
  r.raise_for_status();print(r.status_code,dict(r.headers),flush=True)
  with p.open('wb') as f:
   for chunk in r.iter_content(1024*1024):f.write(chunk)
 print('downloaded',p.stat().st_size,flush=True)
