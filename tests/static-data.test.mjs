import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const source = await readFile(new URL('../js/static-data.js', import.meta.url), 'utf8');
const {queryPoints} = await import(`data:text/javascript;base64,${Buffer.from(source.replace("new URL('../data/points.json', import.meta.url)", "'snapshot'")).toString('base64')}`);
const ids = ['c02', 'ch4', 'n02'];
let loads = 0;
const snapshot = {total: 3, band_half_width: 20, grid_spacing: {latitude: 1, longitude: 1},
    layers: Object.fromEntries(ids.map(id => [id, [0, 50, 100].map(rank => ({[id]: rank + 1, [`${id}_rank`]: rank}))]))};
globalThis.fetch = async () => { loads++; return {ok: true, json: async () => snapshot}; };

test('default query returns all layers and reuses the snapshot', async () => {
    const result = await queryPoints('50,50,50');
    assert.deepEqual(Object.keys(result.layers), ids);
    assert.equal(result.layers.c02.length, 1);
    await queryPoints('100,50,50');
    assert.equal(loads, 1);
});

test('selected pollutant does not read unchanged layers', async () => {
    const original = snapshot.layers;
    snapshot.layers = new Proxy(original, {get(target, id) {
        assert.equal(id, 'ch4');
        return target[id];
    }});
    try {
        const result = await queryPoints('50,100,50', undefined, 'ch4');
        assert.deepEqual(Object.keys(result.layers), ['ch4']);
        assert.equal(result.layers.ch4[0].ch4, 101);
    } finally { snapshot.layers = original; }
});

test('invalid pollutant is rejected', async () => {
    await assert.rejects(queryPoints('50,50,50', undefined, 'unknown'));
});
