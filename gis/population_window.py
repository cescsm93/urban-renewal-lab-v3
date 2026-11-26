"""Query local housing and population within a study circle, with WorldPop fallback."""
import json
import math
import sys
import sqlite3
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

path, x, y, radius = sys.argv[1:]
x, y, radius = map(float, (x, y, radius))
def worldpop():
    cells = []
    missing = 0
    with rasterio.open(path) as src:
        if src.crs.to_epsg() != 4326 or src.transform.b or src.transform.d:
            raise ValueError("Expected north-up WGS84 raster")
        if 70 < x < 140 and 10 < y < 60:
            dy = radius / 110000
            dx = dy / math.cos(math.radians(y + dy))
            top, left = src.index(x - dx, y + dy)
            bottom, right = src.index(x + dx, y - dy)
            window = Window(left, top, right - left + 1, bottom - top + 1)
            grid = src.read(1, window=window, boundless=True, masked=True)
            rows, cols = np.indices(grid.shape)
            lon, lat = src.transform * (cols + left + .5, rows + top + .5)
            h = (np.sin(np.radians(lat - y) / 2) ** 2 +
                 math.cos(math.radians(y)) * np.cos(np.radians(lat)) *
                 np.sin(np.radians(lon - x) / 2) ** 2)
            inside = h <= math.sin(radius / (2 * 6371000)) ** 2
            valid = ~np.ma.getmaskarray(grid) & np.isfinite(grid.data) & (grid.data >= 0)
            missing = int(np.count_nonzero(inside & ~valid))
            for i, j in zip(*np.nonzero(inside & valid)):
                cells.append([float(lon[i,j]), float(lat[i,j]), float(grid.data[i,j])])
    return {"cells":cells, "missing":missing}


def regional(db):
    dy = radius / 110000
    dx = dy / max(.01, math.cos(math.radians(abs(y) + dy)))
    bounds = (x-dx, x+dx, y-dy, y+dy)
    threshold = math.sin(radius / (2 * 6371000)) ** 2
    def query(table, fields):
        sql = f"SELECT x,y,{fields} FROM {table} WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?"
        for lon,lat,*values in db.execute(sql, bounds):
            h = (math.sin(math.radians(lat-y)/2)**2 + math.cos(math.radians(y)) *
                 math.cos(math.radians(lat)) * math.sin(math.radians(lon-x)/2)**2)
            if h <= threshold:
                yield [lon,lat,*values]
    grid = list(query('grid','居住人口,工作人口'))
    homes = list(query('homes','price,name'))
    if not grid:
        return {**worldpop(), "homes":homes}
    cells = [[lon,lat,n] for lon,lat,n,_ in grid if n is not None]
    jobs = [[lon,lat,n] for lon,lat,_,n in grid if n is not None]
    return {"cells":cells, "missing":len(grid)-len(cells), "gridCount":len(grid),
            "workers":sum(row[2] for row in jobs) if jobs else None, "workGrids":len(jobs),
            "workCells":jobs, "homes":homes}

database = Path(__file__).resolve().parents[1] / '.local-data' / 'regional-study.sqlite'
if database.exists():
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        result = regional(db)
else:
    result = worldpop()
# Return small category summaries, including for broad five-kilometre searches.
poi_db = database.with_name('nearby-poi.sqlite')
if poi_db.exists() and 118 <= x <= 120 and 30 <= y <= 33:
    dy = radius / 110000
    dx = dy / math.cos(math.radians(y + dy))
    threshold = math.sin(radius / (2 * 6371000)) ** 2
    summary = {}
    with sqlite3.connect(poi_db.as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute('SELECT name,category,address,x,y FROM poi WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?',
                          (x-dx, x+dx, y-dy, y+dy))
        for name, category, address, lon, lat in rows:
            h = (math.sin(math.radians(lat-y)/2)**2 + math.cos(math.radians(y)) *
                 math.cos(math.radians(lat)) * math.sin(math.radians(lon-x)/2)**2)
            if h > threshold:
                continue
            group = summary.setdefault(category, {'count': 0, 'nearest': []})
            group['count'] += 1
            meters = 12742000 * math.asin(math.sqrt(h))
            place = dict(name=name, address=address if address != '[]' else '', point=[lon,lat], meters=meters)
            if category == '地铁站' and not any(tag in (name + (address or '')) for tag in ('在建', '规划', '未开通', '未开通运营', '建设中')):
                if 'unmarked' not in group or meters < group['unmarked']['meters']:
                    group['unmarked'] = place
            nearest = group['nearest']
            if len(nearest) < 3 or meters < nearest[-1]['meters']:
                nearest.append(place)
                nearest.sort(key=lambda row: row['meters'])
                del nearest[3:]
    result['poiSummary'] = summary
print(json.dumps(result, separators=(",", ":")))
