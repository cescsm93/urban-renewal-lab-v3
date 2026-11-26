"""Build the local POI index from category-specific shapefiles."""
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

import pyogrio

folder, target = map(Path, sys.argv[1:])
layers = {'交通设施服务': '交通', '餐饮服务': '餐饮', '医疗保健服务': '医疗',
          '购物服务': '购物', '科教文化服务': '教育文化', '风景名胜': '景点'}
fd, temp = tempfile.mkstemp(dir=target.parent)
os.close(fd)
db = sqlite3.connect(temp)
try:
    db.execute('CREATE TABLE poi (name TEXT, category TEXT, address TEXT, x REAL, y REAL)')
    for suffix, category in layers.items():
        source, = folder.glob('*_' + suffix + '.shp')
        data = pyogrio.read_dataframe(source, columns=['name','address','typecode','wgs84_经','wgs84_纬'], read_geometry=False)
        data = data.rename(columns={'wgs84_经':'x','wgs84_纬':'y'})
        data = data[data.name.notna() & data.x.between(-180,180) & data.y.between(-90,90)].copy()
        data['category'] = category
        if category == '交通':
            code = data.typecode.astype(str)
            data = data[code.isin(['150500','150700'])].copy()
            data['category'] = data.typecode.astype(str).map({'150500':'地铁站','150700':'公交站'})
        data[['name','category','address','x','y']].drop_duplicates().to_sql('poi', db, if_exists='append', index=False)
    db.execute('CREATE INDEX poi_xy ON poi(x,y)')
    db.commit()
    print(db.execute('SELECT category,count(*) FROM poi GROUP BY category').fetchall())
    db.close()
    os.replace(temp,target)
finally:
    db.close()
    Path(temp).unlink(missing_ok=True)
