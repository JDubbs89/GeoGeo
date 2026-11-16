import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import query_slider, save_points


class QueryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.database = Path(self.directory.name) / 'points.sqlite3'
        save_points([(0, 0, 400, 0, None), (1, 1, 410, 2, 10),
                     (2, 2, 420, 4, 20)], self.database)

    def test_default_query_keeps_all_pollutants(self):
        result = query_slider('50,50,50', self.database)
        self.assertEqual(set(result['layers']), {'c02', 'ch4', 'n02'})
        self.assertEqual(result['layers']['c02'][0]['c02'], 410)
        self.assertEqual(result['total'], 3)
        self.assertEqual(result['grid_spacing'], {'latitude': 1, 'longitude': 1})

    def test_selected_pollutant_only_is_queried(self):
        from backend import query_points
        with patch('backend.query_points', wraps=query_points) as query:
            result = query_slider('50,100,50', self.database, pollutant='ch4')
        self.assertEqual(set(query.call_args.args[0]), {'ch4'})
        self.assertEqual(set(result['layers']), {'ch4'})
        self.assertEqual(result['layers']['ch4'][0]['ch4'], 4)

    def test_invalid_selection_is_rejected(self):
        for pollutant in ('unknown', '', 'CH4'):
            with self.subTest(pollutant=pollutant), self.assertRaises(ValueError):
                query_slider('50,50,50', self.database, pollutant=pollutant)

    def test_invalid_slider_is_rejected(self):
        for value in ('50,50', 'nan,50,50', '-1,50,50', '50,101,50'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                query_slider(value, self.database)
