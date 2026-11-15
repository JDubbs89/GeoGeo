"""SQLite storage and independent pollutant percentile queries."""

import math
import sqlite3
from contextlib import closing
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / 'storage' / 'datapoints.sqlite3'
BAND_HALF_WIDTH = 20.0


def save_points(points, db_path=DB_PATH):
    """Replace the imported grid atomically. Each row is lat, lon, c02, ch4, n02."""
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as db, db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DROP TABLE IF EXISTS datapoints_new')
        db.execute('''CREATE TABLE datapoints_new (
            lat REAL NOT NULL, lon REAL NOT NULL,
            c02 REAL, ch4 REAL, n02 REAL,
            PRIMARY KEY(lat, lon)
        )''')
        db.executemany('INSERT INTO datapoints_new VALUES (?, ?, ?, ?, ?)', points)
        db.execute('DROP TABLE IF EXISTS datapoints')
        db.execute('ALTER TABLE datapoints_new RENAME TO datapoints')
        db.execute('DROP TABLE IF EXISTS sources')


def query_points(bands, db_path=DB_PATH):
    """Rank and filter each pollutant independently, including partially measured locations."""
    with closing(sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        layers = {}
        # Identifiers come from this fixed list, never from request parameters.
        for gas in ('c02', 'ch4', 'n02'):
            rank_expression = f'100.0 * PERCENT_RANK() OVER (ORDER BY {gas})'
            if gas == 'ch4':
                # Zero emissions dominate the grid. Rank positive emissions separately
                # so their useful slider range is not compressed by the zero-value tie.
                rank_expression = '''CASE WHEN ch4 > 0 THEN
                    100.0 * PERCENT_RANK() OVER (PARTITION BY ch4 > 0 ORDER BY ch4)
                    ELSE 0.0 END'''
            rows = db.execute(f"""
                WITH ranked AS (
                    SELECT lat, lon, c02, ch4, n02,
                        {rank_expression} AS {gas}_rank
                    FROM datapoints WHERE {gas} IS NOT NULL
                )
                SELECT * FROM ranked WHERE {gas}_rank BETWEEN :lower AND :upper
                ORDER BY lat, lon
            """, bands[gas])
            layers[gas] = [dict(row) for row in rows]
        return layers


def query_slider(percent, db_path=DB_PATH):
    """Select a percentile band around each pollutant's slider independently."""
    values = [float(value) for value in str(percent).split(',')]
    if len(values) != 3 or any(not math.isfinite(value) or not 0 <= value <= 100 for value in values):
        raise ValueError('Each slider must be between 0 and 100')
    slider_values = dict(zip(('c02', 'ch4', 'n02'), values))
    bands = {gas: {'lower': max(0, value - BAND_HALF_WIDTH),
                   'upper': min(100, value + BAND_HALF_WIDTH)}
             for gas, value in slider_values.items()}
    with closing(sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        total = db.execute("""SELECT COUNT(*) FROM datapoints
            WHERE c02 IS NOT NULL OR ch4 IS NOT NULL OR n02 IS NOT NULL""").fetchone()[0]
        latitudes = [r[0] for r in db.execute('SELECT DISTINCT lat FROM datapoints ORDER BY lat')]
        longitudes = [r[0] for r in db.execute('SELECT DISTINCT lon FROM datapoints ORDER BY lon')]
    spacing = lambda values: min((b-a for a,b in zip(values,values[1:])), default=0)
    return {'layers': query_points(bands, db_path),
        'sliders': slider_values, 'bands': bands, 'total': total,
        'grid_spacing': {'latitude': spacing(latitudes), 'longitude': spacing(longitudes)}}
