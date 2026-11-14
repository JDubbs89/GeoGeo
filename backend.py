"""SQLite storage and the map's combined threshold query."""

import math
import sqlite3
from contextlib import closing
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / 'storage' / 'datapoints.sqlite3'


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


# Relative influence on the combined score. All three sources start equally weighted.
WEIGHTS = {'c02': 1.0, 'ch4': 1.0, 'n02': 1.0}
BAND_HALF_WIDTH = 10.0


def query_points(lower, upper, db_path=DB_PATH):
    """Select a band of combined percentile scores, keeping raw readings for aggregation."""
    total_weight = sum(WEIGHTS.values())
    if total_weight <= 0 or any(not math.isfinite(w) or w < 0 for w in WEIGHTS.values()):
        raise ValueError('Weights must be finite, nonnegative, and sum to more than zero')
    with closing(sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("""
            WITH ranked AS (
                SELECT lat, lon, c02, ch4, n02,
                    PERCENT_RANK() OVER (ORDER BY c02) AS c02_rank,
                    PERCENT_RANK() OVER (ORDER BY ch4) AS ch4_rank,
                    PERCENT_RANK() OVER (ORDER BY n02) AS n02_rank
                FROM datapoints
                WHERE c02 IS NOT NULL AND ch4 IS NOT NULL AND n02 IS NOT NULL
            ), scored AS (
                SELECT lat, lon, c02, ch4, n02,
                    100.0 * (c02_rank * :c02 + ch4_rank * :ch4 + n02_rank * :n02) / :total AS score
                FROM ranked
            )
            SELECT * FROM scored WHERE score BETWEEN :lower AND :upper ORDER BY lat, lon
        """, {**WEIGHTS, 'total': total_weight, 'lower': lower, 'upper': upper})
        return [dict(row) for row in rows]


def query_slider(percent, db_path=DB_PATH):
    percent = float(percent)
    if not math.isfinite(percent) or not 0 <= percent <= 100:
        raise ValueError('Slider must be between 0 and 100')
    lower, upper = max(0, percent - BAND_HALF_WIDTH), min(100, percent + BAND_HALF_WIDTH)
    with closing(sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        total = db.execute("""SELECT COUNT(*) FROM datapoints
            WHERE c02 IS NOT NULL AND ch4 IS NOT NULL AND n02 IS NOT NULL""").fetchone()[0]
        latitudes = [r[0] for r in db.execute('SELECT DISTINCT lat FROM datapoints ORDER BY lat')]
        longitudes = [r[0] for r in db.execute('SELECT DISTINCT lon FROM datapoints ORDER BY lon')]
    spacing = lambda values: min((b-a for a,b in zip(values,values[1:])), default=0)
    return {'points': query_points(lower, upper, db_path),
            'band': {'lower': lower, 'upper': upper}, 'total': total,
            'weights': {key: value/sum(WEIGHTS.values()) for key,value in WEIGHTS.items()},
            'grid_spacing': {'latitude': spacing(latitudes), 'longitude': spacing(longitudes)}}
