import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const ids = ['c02', 'ch4', 'n02'];
const source = (await readFile(new URL('../js/map.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replace('export const', 'const');
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {value: '50', textContent: '', attributes: {},
            events: {}, hasAttribute: () => false,
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(name, callback) { this.events[name] = callback; }});
        return elements.get(id);
    };
    const layers = [];
    class Layer {
        constructor() { this.clears = 0; layers.push(this); }
        addTo() { return this; }
        clearLayers() { this.clears++; }
        addData() {}
    }
    const events = {};
    let west = -180, east = 180;
    const map = {viewMode: '2d', on(names, callback) {
        for (const name of names.split(' ')) events[name] = callback;
    }, getBounds: () => ({getWest: () => west, getEast: () => east}), fitBounds() {}};
    const queries = [], shapes = [];
    runInNewContext(source, {console, document: {readyState: 'complete', getElementById: element},
        TileLayer: class {addTo() {}}, GeoJSON: Layer, CircleMarker: class {},
        LayersControl: class {addTo() {}}, FeatureGroup: class {
            getBounds() { return {isValid: () => true}; }
        }, createGlobeMap: () => ({map}),
        POLLUTANTS: ids.map(id => ({id, label: id, shades: []})), SEVERITY_LEVELS: [],
        getSeverity() {}, pollutantColor() {},
        queryPoints(slider, signal, pollutant) {
            return new Promise((resolve, reject) => queries.push({slider, pollutant, resolve, reject}));
        },
        createPollutantShapes(records) {
            shapes.push(Object.keys(records));
            return Object.fromEntries(Object.keys(records).map(id => [id, {features: []}]));
        }});
    return {queries, shapes, layers, element, events,
        pan() { west = 180; east = 540; events.moveend(); },
        change(id, value) { const slider = element(`${id}-threshold`); slider.value = value; slider.events.input(); }};
}

function respond(query, selected = ids) {
    query.resolve({layers: Object.fromEntries(selected.map(id => [id, [{[id]: 10}]])),
        total: 1, grid_spacing: {latitude: 1, longitude: 1}});
}

test('slider updates query, cluster, and redraw only the changed pollutant', async () => {
    const app = setup();
    assert.equal(app.queries.length, 1);
    respond(app.queries[0]);
    await flush();
    const clears = app.layers.map(layer => layer.clears);
    app.change('ch4', '70');
    assert.equal(app.queries[1].pollutant, 'ch4');
    assert.equal(app.element('c02-band').attributes['aria-busy'], 'false');
    respond(app.queries[1], ['ch4']);
    await flush();
    assert.deepEqual(app.shapes.map(keys => [...keys]), [['c02'], ['ch4'], ['n02'], ['ch4']]);
    assert.equal(app.layers[0].clears, clears[0]);
    assert.ok(app.layers[1].clears > clears[1]);
    assert.equal(app.layers[2].clears, clears[2]);
    app.pan();
    assert.equal(app.queries.length, 2);
    assert.equal(app.shapes.length, 4);
    assert.ok(app.layers.every((layer, i) => layer.clears > clears[i]));
});

test('rapid changes coalesce and discard stale responses independently', async () => {
    const app = setup();
    respond(app.queries[0]);
    await flush();
    app.change('ch4', '60');
    app.change('ch4', '70');
    app.change('ch4', '80');
    app.change('c02', '90');
    assert.equal(app.queries.length, 3);
    respond(app.queries[1], ['ch4']);
    await flush();
    assert.equal(app.shapes.length, 3);
    assert.equal(app.queries[3].slider, '90,80,50');
    assert.equal(app.queries[3].pollutant, 'ch4');
    respond(app.queries[2], ['c02']);
    respond(app.queries[3], ['ch4']);
    await flush();
    assert.deepEqual(app.shapes.slice(3).map(keys => [...keys]), [['c02'], ['ch4']]);
    assert.equal(app.element('ch4-band').attributes['aria-busy'], 'false');
});
