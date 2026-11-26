"""Import a WGS84 building-height shapefile into the local Renewal Lab PostGIS container."""
import argparse
import subprocess
import sys

import pyogrio
import shapely

parser = argparse.ArgumentParser()
parser.add_argument("shapefile")
parser.add_argument("--container", default="renewal-lab-postgis")
args = parser.parse_args()
info = pyogrio.read_info(args.shapefile)
if info["crs"] != "EPSG:4326" or "height" not in info["fields"]:
    sys.exit("Expected WGS84 polygons with a height field")

command = ["docker", "exec", "-i", args.container, "sh", "-c",
           'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
with subprocess.Popen(command, stdin=subprocess.PIPE) as proc:
    def send(sql):
        proc.stdin.write(sql.encode())
    send("""BEGIN;
CREATE TABLE renewal.nanjing_buildings_2024 (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    height real NOT NULL CHECK(height>=0),
    geom geometry(Geometry,4326) NOT NULL
);
COPY renewal.nanjing_buildings_2024(height,geom) FROM STDIN;
""")
    for start in range(0, info["features"], 25000):
        data = pyogrio.read_dataframe(args.shapefile, columns=["height"], skip_features=start, max_features=25000)
        shapes = shapely.to_wkb(shapely.set_srid(data.geometry, 4326), hex=True, include_srid=True)
        for height, shape in zip(data.height, shapes):
            send(f"{float(height)}\t{shape}\n")
    send("\\.\nCREATE INDEX ON renewal.nanjing_buildings_2024 USING gist(geom);\n")
    send("ANALYZE renewal.nanjing_buildings_2024;\nCOMMIT;\n")
    proc.stdin.close()
    if proc.wait():
        sys.exit("Building import failed")
