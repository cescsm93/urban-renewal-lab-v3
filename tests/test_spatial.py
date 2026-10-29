import unittest
from gis.spatial_analysis import analyze


def feature(typ, coords, **props):
    return {'type':'Feature','geometry':{'type':typ,'coordinates':coords},'properties':props}


def collection(items):
    return {'type':'FeatureCollection','features':items}


def square(x, y, d=.00015):
    return [[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]


class SpatialTests(unittest.TestCase):
    def test_walk_coverage_counts_network_reachable_homes(self):
        roads=collection([feature('LineString',[[118.0,32.0],[118.005,32.0]])])
        facilities=collection([feature('Point',[118.0,32.0],name='学校入口')])
        homes=collection([feature('Polygon',[square(118.001,32.0)],name='近处'),
                          feature('Polygon',[square(118.004,32.0)],name='远处')])
        result=analyze({'kind':'coverage','roads':roads,'facilities':facilities,'residences':homes})
        self.assertEqual(result['summary']['counts']['15'],2)
        self.assertEqual(len(result['homes']),2)

    def test_morphology_reports_building_coverage(self):
        area=collection([feature('Polygon',[square(118.0,32.0,.001)],name='片区')])
        buildings=collection([feature('Polygon',[square(118.0001,32.0001,.0002)])])
        roads=collection([feature('LineString',[[118,32],[118.001,32],[118.001,32.001],[118,32.001],[118,32]])])
        result=analyze({'kind':'morphology','areas':area,'buildings':buildings,'roads':roads})
        self.assertGreater(result['rows'][0]['buildingCoveragePct'],0)
        self.assertEqual(result['summary']['buildings'],1)

    def test_hotspot_rejects_small_samples(self):
        with self.assertRaisesRegex(ValueError,'至少需要 10'):
            analyze({'kind':'hotspots','resources':collection([feature('Polygon',[square(118,32)])])})

    def test_hotspot_returns_grid_and_p_values(self):
        resources=collection([feature('Polygon',[square(118+i*.003,32+j*.003,.0001*(1+i%3))])
                              for i in range(5) for j in range(4)])
        result=analyze({'kind':'hotspots','resources':resources,'cellMeters':250})
        self.assertEqual(result['summary']['resources'],20)
        self.assertTrue(result['grid']['features'])
        self.assertIn('pValue',result['grid']['features'][0]['properties'])


if __name__=='__main__':
    unittest.main()
