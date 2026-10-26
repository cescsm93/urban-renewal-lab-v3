"""Read-only GeoPandas/Shapely inspection worker. stdin/stdout are JSON."""
import base64
import io
import json
import math
import os
from pathlib import PurePosixPath, Path
import sys
import tempfile
import zipfile

import geopandas as gpd
import pyproj
from pyproj import CRS
from shapely import force_2d, make_valid
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.validation import explain_validity

pyproj.network.set_network_enabled(False)
MAX_BYTES = 10 * 1024 * 1024
MAX_VERTICES = 200_000


def strict_json(text):
    return json.loads(text, parse_constant=lambda x: (_ for _ in ()).throw(ValueError("坐标或属性包含非法数值：" + x)))


def check_coordinates(value, counter):
    if not isinstance(value, (list, tuple)):
        raise ValueError("几何坐标格式错误")
    if value and isinstance(value[0], (int, float)):
        if len(value) < 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in value):
            raise ValueError("坐标包含空值或非有限数值")
        counter[0] += 1
        if counter[0] > MAX_VERTICES:
            raise ValueError("节点数超过 20 万，请拆分数据后导入")
    else:
        for item in value:
            check_coordinates(item, counter)


def inspect_archive(raw, source_crs):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries = [i for i in z.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
        if len(entries) > 64 or sum(i.file_size for i in entries) > 100 * 1024 * 1024:
            raise ValueError("ZIP 解压内容超过限制（64 个文件／100 MB）")
        names = {}
        for i in entries:
            p = PurePosixPath(i.filename.replace("\\", "/"))
            if p.is_absolute() or ".." in p.parts or ":" in str(p):
                raise ValueError("ZIP 包含不安全的路径")
            if str(p).lower() in names:
                raise ValueError("ZIP 包含重复文件名")
            names[str(p).lower()] = i.filename
        shp_names = [n for n in names if n.endswith(".shp")]
        if len(shp_names) != 1:
            raise ValueError("本次体检每个 ZIP 支持一组 Shapefile，请保留一组同名 shp/shx/dbf/prj")
        stem = shp_names[0][:-4]
        needed = [".shp", ".shx", ".dbf"] + ([] if source_crs else [".prj"])
        missing = [ext for ext in needed if stem + ext not in names]
        if missing:
            raise ValueError("Shapefile 缺少同名组件：" + " / ".join(missing) + "；缺 PRJ 时须明确填写源坐标系")
        # Extract only whitelisted sidecars under a new temporary directory.
        with tempfile.TemporaryDirectory(prefix="renewal-gis-") as folder:
            for ext in [".shp", ".shx", ".dbf", ".prj", ".cpg"]:
                if stem + ext in names:
                    Path(folder, "layer" + ext).write_bytes(z.read(names[stem + ext]))
            frame = gpd.read_file(Path(folder, "layer.shp"), engine="pyogrio")
            crs = source_crs or frame.crs
            if not crs:
                raise ValueError("未识别到坐标系，请明确填写源坐标系")
            records = json.loads(frame.to_json(to_wgs84=False, drop_id=True))
            return records["features"], CRS.from_user_input(crs), bool(source_crs and frame.crs and CRS.from_user_input(source_crs) != frame.crs)


def read_input(payload):
    source_crs = str(payload.get("sourceCRS") or "").strip()
    if "collection" in payload:
        data = payload["collection"]
        size = len(json.dumps(data).encode("utf8"))
    else:
        raw = base64.b64decode(payload.get("data", ""), validate=True)
        size = len(raw)
        if size > MAX_BYTES:
            raise ValueError("文件超过 10 MB，请拆分后导入")
        if str(payload.get("filename", "")).lower().endswith(".zip"):
            return inspect_archive(raw, source_crs)
        data = strict_json(raw.decode("utf-8-sig"))
    if size > MAX_BYTES:
        raise ValueError("文件超过 10 MB")
    if data.get("type") == "FeatureCollection":
        features = data.get("features")
    elif data.get("type") == "Feature":
        features = [data]
    elif data.get("type") in ("Polygon", "MultiPolygon", "Point", "LineString"):
        features = [{"type": "Feature", "properties": {}, "geometry": data}]
    else:
        raise ValueError("请选择 GeoJSON 面资源；项目备份 JSON 请使用原来的导入入口")
    declared = (data.get("crs") or {}).get("properties", {}).get("name")
    crs = CRS.from_user_input(source_crs or declared or "EPSG:4326")
    return features, crs, bool(source_crs and declared and CRS.from_user_input(declared) != crs)


def inspect(payload):
    features, source_crs, overridden = read_input(payload)
    if not isinstance(features, list) or len(features) > 5000:
        raise ValueError("每次最多检查 5000 个要素")
    repair = payload.get("repair") is True
    rows, output, count = [], [], [0]
    warnings = ["明确指定的源坐标系覆盖了文件中的声明"] if overridden else []
    fields = set()
    for idx, feature in enumerate(features):
        row = {"index": idx, "status": "error", "eligible": False, "messages": []}
        try:
            props = feature.get("properties") or {}
            if not isinstance(props, dict):
                raise ValueError("属性应为对象")
            fields.update(str(k) for k in props.keys())
            row["name"] = str(next((props[k] for k in ["name", "名称", "项目名称", "NAME"] if props.get(k) is not None), "要素" + str(idx + 1)))[:200]
            raw_geom = feature.get("geometry")
            if not raw_geom:
                raise ValueError("几何为空")
            if raw_geom.get("type") not in ("Polygon", "MultiPolygon"):
                row.update(status="unsupported", geometryType=raw_geom.get("type"))
                row["messages"].append("本模块仅导入面资源，点线请使用原导入入口")
                rows.append(row)
                continue
            check_coordinates(raw_geom["coordinates"], count)
            geom = shape(raw_geom)
            if geom.is_empty:
                raise ValueError("几何为空")
            row["originalType"] = geom.geom_type
            if geom.has_z:
                geom = force_2d(geom)
                row["messages"].append("已提取二维边界，未保留高程")
            frame = gpd.GeoSeries([geom], crs=source_crs).to_crs("EPSG:4326")
            geom = frame.iloc[0]
            bounds = list(geom.bounds)
            if not all(math.isfinite(n) for n in bounds) or not (-180 <= bounds[0] <= bounds[2] <= 180 and -90 <= bounds[1] <= bounds[3] <= 90):
                raise ValueError("转换后超出经纬度范围，请检查源坐标系；不能猜测坐标系")
            row["bounds"] = bounds
            if bounds[2] - bounds[0] > 6 or bounds[3] - bounds[1] > 8:
                raise ValueError("单个资源范围过大，请按城市或片区拆分后导入")
            before_valid = geom.is_valid
            row["wasValid"] = before_valid
            if not before_valid:
                reason = explain_validity(geom)
                row["messages"].append(reason)
                if not repair:
                    raise ValueError("边界无效；可勾选尝试修复后重新检查")
                geom = make_valid(geom, method="structure", keep_collapsed=False)
                if not isinstance(geom, (Polygon, MultiPolygon)) or geom.is_empty:
                    raise ValueError("修复结果无法保留为面资源，请人工调整")
                row["messages"].append("已生成修复候选，入库前请审查边界与面积")
            if not geom.is_valid:
                raise ValueError("修复后边界仍无效")
            metric = gpd.GeoSeries([geom], crs="EPSG:4326")
            metric_crs = metric.estimate_utm_crs()
            if metric_crs is None:
                raise ValueError("无法选择局部米制投影")
            area = float(metric.to_crs(metric_crs).area.iloc[0]) / 10000
            if not math.isfinite(area) or area <= 1e-8:
                raise ValueError("面积为零或过小")
            parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
            label = geom.representative_point()
            meta = {"areaHa": area, "areaCRS": metric_crs.to_string(), "parts": len(parts), "holes": sum(len(p.interiors) for p in parts), "repaired": not before_valid}
            row.update(status="valid" if before_valid else "repaired", eligible=True, geometryType=geom.geom_type, **meta)
            out = {"type": "Feature", "id": idx, "properties": props, "geometry": mapping(geom), "inspection": {**meta, "labelPoint": [label.x, label.y]}}
            output.append(out)
        except Exception as error:
            row["messages"].append(str(error)[:300])
        rows.append(row)
    return {"sourceCRS": source_crs.to_string(), "targetCRS": "EPSG:4326", "repairRequested": repair, "warnings": warnings,
            "fields": sorted(fields)[:100], "rows": rows, "collection": {"type": "FeatureCollection", "features": output},
            "summary": {"total": len(features), "eligible": len(output), "valid": sum(r["status"] == "valid" for r in rows),
                        "repaired": sum(r["status"] == "repaired" for r in rows), "rejected": sum(not r["eligible"] for r in rows),
                        "areaHa": sum(f["inspection"]["areaHa"] for f in output)},
            "engine": {"geopandas": gpd.__version__, "shapely": __import__("shapely").__version__}}


if __name__ == "__main__":
    try:
        result = inspect(strict_json(sys.stdin.read()))
        sys.stdout.write(json.dumps(result, ensure_ascii=True, allow_nan=False))
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": str(exc)[:500]}, ensure_ascii=True))
        sys.exit(1)
