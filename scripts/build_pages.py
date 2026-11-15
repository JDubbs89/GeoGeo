"""Build the Pages site; pass --export-data to refresh its committed data snapshot."""

import argparse
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export-data', action='store_true')
    args = parser.parse_args()
    snapshot_path = ROOT / 'data' / 'points.json'
    if args.export_data:
        sys.path.insert(0, str(ROOT))
        from backend import BAND_HALF_WIDTH, query_points, query_slider
        snapshot = query_slider('50,50,50')
        snapshot['layers'] = query_points({
            gas: {'lower': 0, 'upper': 100} for gas in ('c02', 'ch4', 'n02')
        })
        snapshot.pop('bands')
        snapshot.pop('sliders')
        snapshot['band_half_width'] = BAND_HALF_WIDTH
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        snapshot_path.write_text(json.dumps(snapshot, separators=(',', ':'), allow_nan=False) + '\n')

    snapshot = json.loads(snapshot_path.read_text())
    if not snapshot['total'] or any(not snapshot['layers'][gas] for gas in ('c02', 'ch4', 'n02')):
        raise ValueError('Export pollutant measurements before building Pages.')
    destination = ROOT / '_site'
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir()
    for directory in ('js', 'styles'):
        shutil.copytree(ROOT / directory, destination / directory)
    for name in ('index.html', 'play.html', 'game.html', 'favicon.ico'):
        shutil.copy2(ROOT / name, destination / name)
    # Match the Python server's landing page while retaining the explorer page.
    shutil.copy2(ROOT / 'index.html', destination / 'explore.html')
    shutil.copy2(ROOT / 'play.html', destination / 'index.html')
    (destination / 'data').mkdir()
    shutil.copy2(snapshot_path, destination / 'data' / 'points.json')
    (destination / 'js' / 'api-data.js').write_text(
        "export {queryPoints} from './static-data.js';\n")
    (destination / '.nojekyll').touch()
    print(f'Built {destination.name} with {snapshot["total"]:,} measurement locations.')


if __name__ == '__main__':
    main()
