"""Small, bounded spatial analyses for user supplied WGS84 GeoJSON data."""
import json
import math
import sys

import geopandas as gpd
import numpy as np
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import unary_union, polygonize


MAX_FEATURES = 2000


def features(value, kinds):
    items = (value or {}).get('features', [])
    if not isinstance(items, list) or len(items) > MAX_FEATURES:
        raise ValueError('GeoJSON 要素数量超过 2000 个，请先裁剪研究范围')
    result = []
    for item in items:
        try:
            geom = shape(item['geometry'])
            if geom.is_valid and not geom.is_empty and geom.geom_type in kinds:
                result.append((geom, item.get('properties') or {}))
        except (KeyError, TypeError, ValueError):
            continue
    return result


def metric_crs(geoms):
    if not geoms:
        raise ValueError('没有可分析的有效几何')
    series = gpd.GeoSeries(geoms, crs='EPSG:4326')
    if any(abs(y) > 85 or abs(x) > 180 for g in geoms for x, y in [g.representative_point().coords[0]]):
        raise ValueError('请上传 WGS84 经纬度 GeoJSON；不能直接上传高德 GCJ-02 坐标')
    return series.estimate_utm_crs()


def project(items, crs):
    return list(gpd.GeoSeries([g for g, _ in items], crs='EPSG:4326').to_crs(crs))


def geojson(geoms, props, crs):
    output = gpd.GeoSeries(geoms, crs=crs).to_crs('EPSG:4326')
    return {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'geometry': mapping(g), 'properties': p}
        for g, p in zip(output, props) if not g.is_empty
    ]}


def coverage(data):
    import networkx as nx
    roads = features(data.get('roads'), {'LineString', 'MultiLineString'})
    facilities = features(data.get('facilities'), {'Point'})
    homes = features(data.get('residences'), {'Polygon', 'MultiPolygon'})
    if not roads or not facilities or not homes:
        raise ValueError('需要步行路网线、设施入口点及居住资源面，均为 WGS84 GeoJSON')
    crs = metric_crs([g for g, _ in roads + facilities + homes])
    segments = unary_union(project(roads, crs))
    lines = list(segments.geoms) if hasattr(segments, 'geoms') else [segments]
    graph = nx.Graph()
    for line in lines:
        if line.geom_type != 'LineString':
            continue
        xy = list(line.coords)
        for a, b in zip(xy, xy[1:]):
            length = math.dist(a[:2], b[:2])
            if length > 0:
                steps = math.ceil(length / 25)
                if steps > 1000:
                    raise ValueError('路段过长，请先裁剪步行路网')
                previous = tuple(a[:2])
                for step in range(1, steps + 1):
                    fraction = step / steps
                    current = (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)
                    graph.add_edge(previous, current, length=length / steps)
                    previous = current
    if not graph or graph.number_of_nodes() > 30000:
        raise ValueError('步行路网为空或过大（最多 3 万节点），请裁剪研究范围')
    from scipy.spatial import cKDTree
    nodes = list(graph.nodes)
    tree = cKDTree(nodes)
    speed = float(data.get('speedMps') or 1.2)
    if not .5 <= speed <= 2:
        raise ValueError('步速须在 0.5–2 米/秒之间')
    for i, pt in enumerate(project(facilities, crs)):
        dist, idx = tree.query((pt.x, pt.y))
        if dist > 200:
            continue
        graph.add_edge(('facility', i), nodes[int(idx)], length=float(dist))
    sources = [('facility', i) for i in range(len(facilities)) if ('facility', i) in graph]
    if not sources:
        raise ValueError('设施入口离步行路网均超过 200 米；请核对坐标与路网覆盖')
    distances = nx.multi_source_dijkstra_path_length(graph, sources, cutoff=speed * 900, weight='length')
    homes_m = project(homes, crs)
    home_results = []
    for home, (_, props) in zip(homes_m, homes):
        pt = home.representative_point()
        snap, idx = tree.query((pt.x, pt.y))
        d = distances.get(nodes[int(idx)], math.inf) + float(snap) if snap <= 200 else math.inf
        minutes = d / speed / 60
        home_results.append({'name': str(props.get('name') or props.get('名称') or '居住资源'),
                             'minutes': round(minutes, 1) if math.isfinite(minutes) else None,
                             'snapMeters': round(float(snap)),
                             'band': 5 if minutes <= 5 else 10 if minutes <= 10 else 15 if minutes <= 15 else None})
    zones = []
    zone_props = []
    for minutes in (5, 10, 15):
        length_limit = minutes * 60 * speed
        reached = []
        for a, b, attr in graph.edges(data=True):
            da, db = distances.get(a, math.inf), distances.get(b, math.inf)
            if da <= length_limit and db <= length_limit and isinstance(a[0], (int, float)) and isinstance(b[0], (int, float)):
                from shapely.geometry import LineString
                reached.append(LineString([a, b]))
        zones.append(unary_union(reached).buffer(25) if reached else Point().buffer(0))
        zone_props.append({'minutes': minutes, 'coveredHomes': sum(r['band'] is not None and r['band'] <= minutes for r in home_results)})
    return {'zones': geojson(zones, zone_props, crs), 'homes': home_results,
            'summary': {'facilities': len(sources), 'roadNodes': len(nodes), 'roadEdges': graph.number_of_edges(),
                        'residences': len(homes), 'counts': {str(m): p['coveredHomes'] for m, p in zip((5, 10, 15), zone_props)}},
            'method': '步行路网最短路径，步速 %.1f 米/秒；设施和住宅代表点吸附最近路网节点，连接距离计入时间。彩色带为可达路段 25 米示意缓冲，并非地块或人口的完整覆盖面。' % speed,
            'limits': '仅包含上传的可步行线和设施入口；未建模过街、围墙、楼宇入口、坡度及开放时间。距路网超过 200 米的设施或居住代表点不参与覆盖计数。'}


def morphology(data):
    import momepy
    buildings = features(data.get('buildings'), {'Polygon', 'MultiPolygon'})
    roads = features(data.get('roads'), {'LineString', 'MultiLineString'})
    areas = features(data.get('areas'), {'Polygon', 'MultiPolygon'})
    if not buildings or not roads or not areas:
        raise ValueError('需要建筑轮廓、街道线和更新资源面，均为 WGS84 GeoJSON')
    crs = metric_crs([g for g, _ in buildings + roads + areas])
    bs, rs, aa = (project(x, crs) for x in (buildings, roads, areas))
    road_union = unary_union(rs)
    blocks = [p for p in polygonize(road_union) if p.area >= 100]
    street_parts = [g for g in (road_union.geoms if hasattr(road_union, 'geoms') else [road_union]) if g.geom_type == 'LineString']
    graph = momepy.gdf_to_nx(gpd.GeoDataFrame(geometry=gpd.GeoSeries(street_parts, crs=crs)), approach='primal')
    degrees = [d for _, d in graph.degree()]
    rows = []
    for area, (_, props) in zip(aa, areas):
        if area.area <= 0:
            continue
        clipped = [b.intersection(area) for b in bs if b.intersects(area)]
        covered = unary_union(clipped).area if clipped else 0
        local_blocks = [b for b in blocks if area.intersects(b.representative_point())]
        local_streets = road_union.intersection(area)
        rows.append({'name': str(props.get('name') or '更新资源'), 'buildingCoveragePct': round(100 * covered / area.area, 1),
                     'buildingCount': len(clipped), 'streetMetersPerHa': round(local_streets.length / (area.area / 10000), 1),
                     'medianBlockHa': round(float(np.median([b.area / 10000 for b in local_blocks])), 2) if local_blocks else None})
    return {'rows': rows, 'summary': {'buildings': len(bs), 'streets': len(rs), 'blocks': len(blocks),
                                     'streetNodes': len(degrees), 'meanNodeDegree': round(float(np.mean(degrees)), 2) if degrees else None},
            'method': 'momepy 构建街道节点图；建筑覆盖率为建筑轮廓与资源面相交后并集面积／资源面积；街道长度按资源面内路段计；街区为闭合街道围合面。',
            'limits': '建筑轮廓缺失、道路断点和研究范围裁剪会影响结果；建筑覆盖率不是容积率，节点度数不等于实际通行能力。指标只辅助实地研判。'}


def hotspots(data):
    from esda.moran import Moran, Moran_Local
    from libpysal.weights import lat2W
    resources = features(data.get('resources'), {'Polygon', 'MultiPolygon'})
    if len(resources) < 10:
        raise ValueError('至少需要 10 处有效更新资源，才适合做统计热点检验')
    crs = metric_crs([g for g, _ in resources])
    polys = project(resources, crs)
    bounds = gpd.GeoSeries(polys, crs=crs).total_bounds
    cell = float(data.get('cellMeters') or 500)
    if cell not in (250, 500, 1000):
        raise ValueError('网格边长请选择 250、500 或 1000 米')
    xmin, ymin = math.floor(bounds[0] / cell) * cell, math.floor(bounds[1] / cell) * cell
    nx = max(4, math.ceil((bounds[2] - xmin) / cell) + 1)
    ny = max(4, math.ceil((bounds[3] - ymin) / cell) + 1)
    if nx * ny > 2500:
        raise ValueError('分析网格超过 2500 格，请增大网格尺寸或缩小资源范围')
    values = np.zeros((ny, nx), dtype=float)
    for p in polys:
        c = p.representative_point()
        x = min(nx - 1, max(0, int((c.x - xmin) // cell)))
        y = min(ny - 1, max(0, int((c.y - ymin) // cell)))
        values[y, x] += p.area / 10000
    flat = values.ravel()
    if np.count_nonzero(flat) < 5 or np.unique(flat).size < 3:
        raise ValueError('有效资源网格太少或强度差异不足，不能可靠检验聚集性；请扩大数据范围或调整网格')
    w = lat2W(ny, nx, rook=False)
    global_m = Moran(flat, w, permutations=199)
    local = Moran_Local(flat, w, permutations=199, seed=12345, n_jobs=1, keep_simulations=False, alternative='two-sided')
    geoms, props = [], []
    for y in range(ny):
        for x in range(nx):
            i = y * nx + x
            if flat[i] <= 0:
                continue
            cls = '高高聚集' if local.q[i] == 1 and local.p_sim[i] < .05 else '其他／未显著'
            geoms.append(box(xmin + x * cell, ymin + y * cell, xmin + (x + 1) * cell, ymin + (y + 1) * cell))
            props.append({'intensityHa': round(float(flat[i]), 2), 'pValue': round(float(local.p_sim[i]), 3), 'class': cls})
    return {'grid': geojson(geoms, props, crs),
            'summary': {'resources': len(resources), 'cells': int(nx * ny), 'occupiedCells': int(np.count_nonzero(flat)),
                        'hotCells': sum(p['class'] == '高高聚集' for p in props),
                        'globalMoranI': round(float(global_m.I), 3), 'globalP': round(float(global_m.p_sim), 3)},
            'method': '每格累加资源面积（ha），Queen 邻接权重；全局与局部 Moran I，199 次置换。全局 p 为单侧置换值，局部高高格显示双侧原始 p<0.05。空格参与统计。',
            'limits': '探索性结果，局部 p 值未做多重比较校正；网格大小、边界与资源样本量会改变结果。不能仅凭颜色认定政策优先级。'}


def analyze(payload):
    kind = payload.get('kind')
    if kind == 'coverage':
        return coverage(payload)
    if kind == 'morphology':
        return morphology(payload)
    if kind == 'hotspots':
        return hotspots(payload)
    raise ValueError('未知分析类型')


if __name__ == '__main__':
    try:
        print(json.dumps(analyze(json.load(sys.stdin)), ensure_ascii=False, allow_nan=False))
    except Exception as exc:
        print(json.dumps({'error': str(exc)[:500]}, ensure_ascii=False))
        sys.exit(1)
