"""Read the configured OPeNDAP sources and align them to one sampled grid."""

import math
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np
import requests
from dotenv import load_dotenv
from pydap.client import open_url
from scipy.spatial import cKDTree

# env keys, remote variable, output column
SOURCES = (
    (('C02DATA', 'CO2DATA'), 'XCO2', 'c02'),
    (('CH4DATA',), 'total_fuel_exploitation_emis_ch4', 'ch4'),
    (('N02DATA', 'NO2DATA'), 'SurfaceNO2', 'n02'),
)


class EarthdataSession(requests.Session):
    def rebuild_auth(self, request, response):
        super().rebuild_auth(request, response)
        url = urlsplit(request.url)
        if url.scheme == 'https' and url.hostname in ('opendap.earthdata.nasa.gov', 'urs.earthdata.nasa.gov'):
            request.prepare_auth(self.auth)
        else:
            request.headers.pop('Authorization', None)


def values(variable, selection):
    data = np.ma.asarray(variable[selection].data, dtype=float)
    for name in ('_FillValue', 'missing_value'):
        for missing in np.asarray(variable.attributes.get(name, [])).ravel():
            data = np.ma.masked_where(data == float(missing), data)
    data = data * float(variable.attributes.get('scale_factor', 1)) + float(variable.attributes.get('add_offset', 0))
    return np.ma.masked_invalid(data).filled(np.nan)


def fetch_source(url, variable_name, max_points=5000, ppm=False):
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.username or parts.password:
        raise ValueError('Use an HTTPS OPeNDAP URL without embedded credentials')
    with EarthdataSession() as session:
        if parts.hostname == 'opendap.earthdata.nasa.gov':
            if not os.getenv('DISCUSER') or not os.getenv('DISCPASS'):
                raise ValueError('Set DISCUSER and DISCPASS in .env')
            session.auth = (os.environ['DISCUSER'], os.environ['DISCPASS'])
        session.get(urlunsplit(parts._replace(path=parts.path + '.dmr')), timeout=60).raise_for_status()
        dataset = open_url(url, session=session, protocol='dap4', timeout=60, get_kwargs={'cookies': session.cookies})
        lat, lon = values(dataset['lat'], slice(None)), values(dataset['lon'], slice(None))
        step = max(1, math.ceil(math.sqrt(len(lat) * len(lon) / max_points)))
        lat, lon = lat[::step], lon[::step]
        variable = dataset[variable_name]
        dims = [dim.lstrip('/') for dim in variable.dims]
        selection = tuple(slice(None, None, step) if dim in ('lat', 'lon') else slice(0, 1) for dim in dims)
        data = values(variable, selection)
        order = [dims.index('lat'), dims.index('lon')] + [i for i, dim in enumerate(dims) if dim not in ('lat', 'lon')]
        data = data.transpose(order).reshape(len(lat), len(lon))
        if ppm:
            unit = variable.attributes.get('units', '').strip().lower()
            if unit in ('mol co2/mol dry', 'mol/mol', 'mol mol-1'):
                data *= 1e6
            elif unit not in ('ppm', 'ppmv', 'umol/mol', 'µmol/mol'):
                raise ValueError('Unrecognized CO2 units')
    lon = (lon + 180) % 360 - 180
    lat_grid, lon_grid = np.meshgrid(lat, lon, indexing='ij')
    return np.column_stack((lat_grid.ravel(), lon_grid.ravel(), data.ravel()))


def xyz(coords):
    lat, lon = np.radians(coords).T
    return np.column_stack((np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)))


def align_grids(grids):
    """Use CO2 locations; take the nearest sampled cell, retaining missing values."""
    coords = grids['c02'][:, :2]
    columns = []
    for field in ('c02', 'ch4', 'n02'):
        grid = grids[field]
        if field == 'c02':
            columns.append(grid[:, 2].copy())
            continue
        _, indices = cKDTree(xyz(grid[:, :2])).query(xyz(coords))
        data = grid[indices, 2].copy()
        # Do not extend a regional source across the rest of the world.
        latitudes = np.unique(grid[:, 0])
        half_step = np.median(np.diff(latitudes))/2 if len(latitudes) > 1 else 0
        outside = (coords[:, 0] < latitudes[0]-half_step) | (coords[:, 0] > latitudes[-1]+half_step)
        data[outside] = np.nan
        columns.append(data)
    return [tuple(None if not np.isfinite(value) else float(value) for value in row)
            for row in np.column_stack((coords, *columns))]


def import_points():
    load_dotenv(Path(__file__).resolve().parent / '.env')
    grids = {}
    for aliases, default_variable, field in SOURCES:
        url = next((os.environ[key].strip() for key in aliases if os.getenv(key)), None)
        if not url:
            raise ValueError(f'Set {aliases[0]} in .env')
        prefix = {'c02': 'CO2', 'ch4': 'CH4', 'n02': 'NO2'}[field]
        maximum = int(os.getenv(prefix + '_MAX_POINTS', '10000'))
        if maximum < 1:
            raise ValueError('Sample targets must be positive')
        grids[field] = fetch_source(url, os.getenv(prefix + '_VARIABLE', default_variable), maximum, field == 'c02')
        print(f'{field}: downloaded {len(grids[field]):,} sampled cells', flush=True)
    return align_grids(grids)
