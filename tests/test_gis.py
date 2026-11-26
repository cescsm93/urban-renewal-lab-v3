"""Regression cases for geometry preservation, explicit repair and CRS handling."""
import base64
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import zipfile
import unittest
import geopandas as gpd
from shapely.geometry import Polygon, MultiPolygon, mapping, shape

spec = importlib.util.spec_from_file_location('inspector', Path(__file__).parents[1] / 'gis' / 'inspect_data.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
outer = [(113.3, 23.1), (113.31, 23.1), (113.31, 23.11), (113.3, 23.11), (113.3, 23.1)]
hole = [(113.303, 23.103), (113.307, 23.103), (113.307, 23.107), (113.303, 23.107), (113.303, 23.103)]
def feature(geom, props=None):
    return {'type': 'Feature', 'geometry': mapping(geom), 'properties': props or {'name': '中文资源', 'type': '居住'}}
def collection(*items):
    return {'type': 'FeatureCollection', 'features': list(items)}

class DataInspectionTests(unittest.TestCase):
    def inspect_one(self, geom, **kwargs):
        return worker.inspect({'collection': collection(feature(geom)), **kwargs})

    def test_hole_area_and_original_untouched(self):
        geom = Polygon(outer, [hole])
        payload = {'collection': collection(feature(geom))}
        before = deepcopy(payload)
        out = worker.inspect(payload)
        result = out['collection']['features'][0]
        self.assertEqual(payload, before)
        self.assertEqual(result['inspection']['holes'], 1)
        self.assertTrue(shape(result['geometry']).equals(geom))
        expected = gpd.GeoSeries([geom], crs=4326).to_crs(32649).area[0] / 10000
        self.assertAlmostEqual(expected, result['inspection']['areaHa'], places=8)
        self.assertTrue(geom.contains(__import__('shapely').Point(result['inspection']['labelPoint'])))

    def test_multi_not_split_into_resources(self):
        multi = MultiPolygon([Polygon(outer), Polygon([(113.32,23.1),(113.33,23.1),(113.33,23.11),(113.32,23.1)])])
        out = self.inspect_one(multi)
        self.assertEqual(out['summary']['eligible'], 1)
        self.assertEqual(out['collection']['features'][0]['inspection']['parts'], 2)

    def test_repair_requires_explicit_flag(self):
        bow = Polygon([(113.3,23.1),(113.31,23.11),(113.3,23.11),(113.31,23.1),(113.3,23.1)])
        self.assertEqual(self.inspect_one(bow)['summary']['eligible'], 0)
        out = self.inspect_one(bow, repair=True)
        self.assertEqual(out['summary']['repaired'], 1)
        self.assertTrue(shape(out['collection']['features'][0]['geometry']).is_valid)
        collapsed = Polygon([(113.3,23.1),(113.31,23.1),(113.32,23.1),(113.3,23.1)])
        self.assertEqual(self.inspect_one(collapsed, repair=True)['summary']['eligible'], 0)

    def test_projected_coordinates_require_crs(self):
        projected = gpd.GeoSeries([Polygon(outer)], crs=4326).to_crs(3857)[0]
        self.assertEqual(self.inspect_one(projected)['summary']['eligible'], 0)
        result = self.inspect_one(projected, sourceCRS='EPSG:3857')['collection']['features'][0]
        self.assertTrue(shape(result['geometry']).equals_exact(Polygon(outer), 1e-8))

    def test_real_shapefile_components_and_encoding(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            gpd.GeoDataFrame({'name':['测试公园'], 'type':['公共设施']}, geometry=[Polygon(outer, [hole])], crs=4326).to_file(folder/'sample.shp', engine='pyogrio', encoding='UTF-8')
            def archive(skip=None, unsafe=False):
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer,'w') as z:
                    for file in folder.iterdir():
                        if file.suffix != skip:
                            z.write(file, 'nested/'+file.name)
                    if unsafe: z.writestr('../evil.txt', 'x')
                return {'filename':'test.zip', 'data':base64.b64encode(buffer.getvalue()).decode()}
            out = worker.inspect(archive())
            self.assertEqual(out['collection']['features'][0]['properties']['name'], '测试公园')
            self.assertEqual(out['rows'][0]['holes'], 1)
            for ext in ['.shx','.dbf','.prj']:
                with self.assertRaisesRegex(ValueError,'缺少'):
                    worker.inspect(archive(skip=ext))
            self.assertEqual(worker.inspect({**archive(skip='.prj'),'sourceCRS':'EPSG:4326'})['summary']['eligible'],1)
            with self.assertRaisesRegex(ValueError, '不安全'):
                worker.inspect(archive(unsafe=True))

    def test_point_unsupported_nan_and_limit(self):
        from shapely.geometry import Point
        self.assertEqual(self.inspect_one(Point(113.3,23.1))['rows'][0]['status'],'unsupported')
        with self.assertRaises(ValueError): worker.strict_json('{"x":NaN}')
        with self.assertRaises(ValueError): worker.inspect({'collection':collection(*([feature(Polygon(outer))]*5001))})

if __name__ == '__main__': unittest.main()
