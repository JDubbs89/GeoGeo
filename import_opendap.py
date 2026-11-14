"""Run once (or after changing .env): venv/bin/python import_opendap.py"""

from backend import DB_PATH, save_points
from opendap import import_points

if __name__ == '__main__':
    try:
        points = import_points()
        save_points(points)
    except Exception as error:
        # Never print authentication responses, headers, or credential-bearing URLs.
        raise SystemExit(f'Import failed ({type(error).__name__}); check .env URLs, variables and credentials.') from None
    print(f'Saved {len(points):,} aligned points in {DB_PATH}')
