"""Build local study tables from the supplied population GDB and housing shapefile."""
import argparse
import sqlite3
from pathlib import Path

import pyogrio

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('gdb')
parser.add_argument('shapefile')
parser.add_argument('output', type=Path)
parser.add_argument('--grid-layer', required=True)
parser.add_argument('--month', required=True, help='Population data month (YYYYMM)')
args = parser.parse_args()
target = args.output
temp = target.with_suffix('.building')
if temp.exists():
    raise FileExistsError(temp)
db = sqlite3.connect(temp)
try:
    grid = pyogrio.read_dataframe(args.gdb, layer=args.grid_layer, columns=['ID'])
    assert grid.crs and grid.crs.is_projected and grid.ID.is_unique
    centers = grid.geometry.centroid.to_crs(4326)
    grid['x'], grid['y'] = centers.x, centers.y
    for field in ['居住人口', '工作人口']:
        layer = pyogrio.read_dataframe(args.gdb, layer='百米格网'+field, read_geometry=False)
        month = layer[layer['月份'].astype(str) == args.month].set_index('ID')
        assert len(month) and month.index.is_unique and month.index.isin(grid.ID).all()
        grid[field] = grid.ID.map(month[field].where(month[field] >= 0))
    grid[['x','y','居住人口','工作人口']].to_sql('grid',db,index=False)
    cols = ['名称','经度_84','纬度_84','价格_元_平','物业类型']
    homes = pyogrio.read_dataframe(args.shapefile,encoding='GBK',columns=cols,read_geometry=False)
    homes = homes[homes['物业类型'].isin(['公寓住宅','别墅']) & (homes['价格_元_平'] > 0) &
                  homes['经度_84'].between(70,140) & homes['纬度_84'].between(10,60) &
                  homes['名称'].fillna('').str.strip().ne('')].drop_duplicates(cols)
    homes.rename(columns=dict(zip(cols,['name','x','y','price','kind']))).to_sql('homes',db,index=False)
    for table in ['grid','homes']:
        db.execute(f'CREATE INDEX {table}_xy ON {table}(x,y)')
    db.commit()
    print('grid',len(grid),'homes',len(homes))
finally:
    db.close()
temp.replace(target)
