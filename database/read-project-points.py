"""Read one WGS84 point layer using GDAL virtual ZIP access. Emit UTF-8 JSON to the importer."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

import pandas as pd
import pyogrio


def extract(archive, layer):
    with zipfile.ZipFile(archive) as source:
        roots = {n.rsplit("/", 1)[0] for n in source.namelist()
                 if n.lower().endswith(".gdb/a00000001.gdbtable")}
    if len(roots) != 1:
        raise ValueError("Expected exactly one FileGDB in archive")
    location = "/vsizip/" + archive.resolve().as_posix() + "/" + roots.pop()
    info = pyogrio.read_info(location, layer=layer)
    if info["crs"] != "EPSG:4326" or info["geometry_type"] != "Point":
        raise ValueError("Expected WGS84 point geometry")
    fields = list(info["fields"])
    frame = pyogrio.read_dataframe(location, layer=layer, fid_as_index=True)
    records = []
    for fid, row in frame.iterrows():
        point = row.geometry
        if point is None:
            raise ValueError("Null geometry requires explicit handling")
        props = {key: None if pd.isna(row[key]) else row[key] for key in fields}
        records.append(dict(fid=str(fid), wkb=point.wkb_hex, properties=props))
    if not records or len(records) != info["features"] or not frame.index.is_unique:
        raise ValueError("Incomplete layer or duplicate source feature ID")
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return dict(fields=fields, records=records, hash=digest, empty=int(frame.geometry.is_empty.sum()))


if __name__ == "__main__":
    payload = extract(Path(sys.argv[1]), sys.argv[2])
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf8"))
