"""Read the 2015-02-01 OCO-2 daily grid using server-side Earthdata auth."""

import os
from functools import lru_cache
from urllib.parse import urlparse

import numpy as np
import requests
from pydap.client import open_url


DATASET_URL = (
    "https://opendap.earthdata.nasa.gov/collections/C2240248762-GES_DISC/"
    "granules/OCO2_GEOS_L3CO2_DAY.10r%3A"
    "oco2_GEOS_L3CO2_day_20150201_B10206Ar.nc4"
)


class MissingCredentialsError(Exception):
    pass


class EarthdataSession(requests.Session):
    """Keep Basic auth across the NASA data/login redirect, with cookies."""

    def rebuild_auth(self, prepared_request, response):
        super().rebuild_auth(prepared_request, response)
        destination = urlparse(prepared_request.url)
        if destination.scheme == "https" and destination.hostname in {
            "opendap.earthdata.nasa.gov", "urs.earthdata.nasa.gov"
        }:
            prepared_request.prepare_auth(self.auth)
        else:
            prepared_request.headers.pop("Authorization", None)


def read_values(variable, selection):
    """Mask packed missing values before applying NetCDF scale/offset."""
    values = np.ma.asarray(variable[selection].data, dtype=float)
    for name in ("_FillValue", "missing_value"):
        for missing in np.asarray(variable.attributes.get(name, [])).ravel():
            values = np.ma.masked_where(values == float(missing), values)
    values = values * float(variable.attributes.get("scale_factor", 1))
    values = values + float(variable.attributes.get("add_offset", 0))
    return np.ma.masked_invalid(values)


def ppm_factor(variable):
    units = variable.attributes.get("units", "").strip().lower()
    if units in {"mol co2/mol dry", "mol/mol", "mol mol-1"}:
        return 1e6
    if units in {"ppm", "ppmv", "umol/mol", "µmol/mol"}:
        return 1
    raise ValueError("Unsupported CO2 units in NASA response")


@lru_cache(maxsize=4)
def load_co2(stride):
    username, password = os.getenv("DISCUSER"), os.getenv("DISCPASS")
    if not username or not password:
        raise MissingCredentialsError("Set DISCUSER and DISCPASS in the server's .env file.")

    with EarthdataSession() as session:
        session.auth = (username, password)
        # Establish the login cookies first. PyDAP 3.5.11 creates its own
        # sessions internally, so pass cookies explicitly to every DAP request.
        response = session.get(DATASET_URL + ".dmr", timeout=60)
        response.raise_for_status()
        dataset = open_url(
            DATASET_URL, session=session, protocol="dap4", timeout=60,
            get_kwargs={"cookies": session.cookies},
        )
        lat = read_values(dataset["lat"], slice(None, None, stride))
        lon = read_values(dataset["lon"], slice(None, None, stride))
        selection = (slice(0, 1), slice(None, None, stride), slice(None, None, stride))
        co2 = read_values(dataset["XCO2"], selection)[0] * ppm_factor(dataset["XCO2"])
        precision = read_values(dataset["XCO2PREC"], selection)[0] * ppm_factor(dataset["XCO2PREC"])

    if co2.shape != (len(lat), len(lon)) or precision.shape != co2.shape:
        raise ValueError("Unexpected NASA coordinate/data dimensions")

    points = []
    for i, latitude in enumerate(lat):
        for j, longitude in enumerate(lon):
            if any(np.ma.is_masked(value) for value in (latitude, longitude, co2[i, j])):
                continue
            points.append({
                "coords": {"lat": float(latitude), "lng": float(longitude)},
                "C02Level": float(co2[i, j]),
                "CO2Precision": None if np.ma.is_masked(precision[i, j]) else float(precision[i, j]),
            })

    return {
        "date": "2015-02-01",
        "units": "ppm",
        "stride": stride,
        "source": DATASET_URL,
        "Data": points,
    }
