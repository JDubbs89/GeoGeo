import json
import unittest
from unittest.mock import patch

import numpy as np
import requests
from pydap.model import BaseType
from starlette.requests import Request

import co2
import server


class CO2Tests(unittest.TestCase):
    def setUp(self):
        co2.load_co2.cache_clear()
        self.addCleanup(co2.load_co2.cache_clear)

    def test_coordinates_scaling_missing_values_and_precision(self):
        dataset = {
            "lat": BaseType("lat", data=np.array([-1., 0., 1.])),
            "lon": BaseType("lon", data=np.array([10., 11., 12.])),
            "XCO2": BaseType("XCO2", data=np.array([[
                [400., 401., -999.], [402., 403., 404.], [405., 406., 407.]
            ]]), attributes={"units": "mol CO2/mol dry", "_FillValue": -999., "scale_factor": 1e-6}),
            "XCO2PREC": BaseType("XCO2PREC", data=np.array([[
                [1., 1., 1.], [1., 1., 1.], [-999., 1., 2.]
            ]]), attributes={"units": "ppm", "missing_value": -999.}),
        }
        with patch.dict("os.environ", {"DISCUSER": "test", "DISCPASS": "test"}), \
             patch.object(co2.EarthdataSession, "get") as get, \
             patch.object(co2, "open_url", return_value=dataset) as open_url:
            payload = co2.load_co2(2)
            get.return_value.raise_for_status.assert_called_once()
            self.assertIn("cookies", open_url.call_args.kwargs["get_kwargs"])
        self.assertEqual(len(payload["Data"]), 3)
        first, second, third = payload["Data"]
        self.assertEqual(first["coords"], {"lat": -1., "lng": 10.})
        self.assertAlmostEqual(first["C02Level"], 400.)
        self.assertEqual(second["coords"], {"lat": 1., "lng": 10.})
        self.assertIsNone(second["CO2Precision"])
        self.assertAlmostEqual(third["C02Level"], 407.)
        self.assertEqual(third["CO2Precision"], 2.)
        json.dumps(payload, allow_nan=False)

    def test_api_rejects_invalid_stride_before_fetch(self):
        for query in (b"stride=0", b"stride=33", b"stride=abc"):
            with self.subTest(query=query), patch.object(server, "load_co2") as load:
                response = server.co2_data(Request({"type": "http", "query_string": query}))
                self.assertEqual(response.status_code, 400)
                load.assert_not_called()

    def test_api_does_not_expose_authentication_error_details(self):
        upstream = requests.Response()
        upstream.status_code = 401
        error = requests.HTTPError("sensitive upstream details", response=upstream)
        with patch.object(server, "load_co2", side_effect=error):
            response = server.co2_data(Request({"type": "http", "query_string": b""}))
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(b"sensitive", response.body)
        self.assertIn(b"Earthdata rejected access", response.body)

    def test_redirect_only_authenticates_known_https_hosts(self):
        with co2.EarthdataSession() as session:
            session.auth = ("test", "secret")
            previous = requests.Response()
            previous.request = requests.Request("GET", co2.DATASET_URL).prepare()
            for url, allowed in (
                ("https://urs.earthdata.nasa.gov/login", True),
                ("https://example.org/", False),
                ("http://urs.earthdata.nasa.gov/login", False),
            ):
                request = requests.Request("GET", url, auth=session.auth).prepare()
                session.rebuild_auth(request, previous)
                self.assertEqual("Authorization" in request.headers, allowed)


if __name__ == "__main__":
    unittest.main()
