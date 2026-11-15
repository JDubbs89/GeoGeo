"""Check that Pages queries preserve the local API's percentile behavior."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from backend import BAND_HALF_WIDTH, query_points, query_slider, save_points

ROOT = Path(__file__).resolve().parents[1]


class PagesTests(unittest.TestCase):
    def test_static_queries_match_api(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'points.sqlite3'
            save_points([
                (0, 0, 400, 0, None), (1, 1, 410, 0, 2),
                (2, 2, 410, 1, 3), (3, 3, 420, 5, 4),
                (4, 4, None, 10, 5), (5, 5, 430, None, 6),
            ], database)
            snapshot = query_slider('50,50,50', database)
            snapshot['layers'] = query_points({
                gas: {'lower': 0, 'upper': 100} for gas in ('c02', 'ch4', 'n02')
            }, database)
            snapshot['band_half_width'] = BAND_HALF_WIDTH
            cases = ['0,0,0', '50,50,50', '100,100,100', '19,20,21', '80,90,10', '25.5,40.5,60.5']
            payload = {'snapshot': snapshot, 'cases': cases,
                       'expected': [query_slider(case, database) for case in cases]}
            script = """
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {snapshot, cases, expected} = JSON.parse(fs.readFileSync(0, 'utf8'));
let requests = 0;
globalThis.fetch = async url => {
    assert.ok(url.pathname.endsWith('/data/points.json'));
    requests++;
    return {ok: true, json: async () => snapshot};
};
const {queryPoints} = await import('./js/static-data.js');
for (const [index, slider] of cases.entries()) {
    assert.deepEqual(await queryPoints(slider), expected[index]);
}
assert.equal(requests, 1, 'cache the snapshot across queries');
for (const slider of ['0,0', '0,,0', '-1,0,0', '0,101,0', 'NaN,0,0']) {
    await assert.rejects(queryPoints(slider), /between 0 and 100/);
}
const controller = new AbortController();
controller.abort();
await assert.rejects(queryPoints('50,50,50', controller.signal), {name: 'AbortError'});
"""
            subprocess.run(['node', '--input-type=module', '-e', script],
                           input=json.dumps(payload), text=True, cwd=ROOT, check=True)


if __name__ == '__main__':
    unittest.main()
