import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

const source = (await readFile(new URL('../js/globe.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replace('export function', 'function');
const queueSource = (await readFile(new URL('../js/globe-layer-queue.js', import.meta.url), 'utf8'))
    .replace('export function', 'function');

function setup() {
    const frames = new Map();
    let nextFrame = 0, markerCount = 0, scans = 0, clipping = 0;
    const icons = [];
    function element() {
        return {style: {}, dataset: {}, children: [], events: {},
            classList: {add() {}}, append(...items) { this.children.push(...items); },
            setAttribute() {}, addEventListener(name, callback) { this.events[name] = callback; },
            closest: () => null, getContext: () => ({getExtension() {}}),
            querySelector: () => element(), querySelectorAll() { scans++; return icons; }};
    }
    class LeafletMap {
        constructor() { this.events = {}; this.layers = new Set(); }
        setView() { return this; }
        createPane() { return {style: {}}; }
        on(name, callback) { this.events[name] = callback; }
        fire(name, event) { this.events[name]?.(event); }
        eachLayer(callback) { this.layers.forEach(callback); }
        getCenter() { return {lat: 20, lng: 0}; }
        getZoom() { return 2; }
        invalidateSize() {}
        fitBounds() {}
    }
    class Marker {
        constructor() { this.options = {}; }
        getLatLng() { return {lat: 0, lng: 0}; }
        getPopup() {}
        getTooltip() {}
        on() {}
        off() {}
    }
    class CircleMarker extends Marker {}
    class Polyline {}
    class Polygon extends Polyline {
        constructor(geometry) { super(); this.feature = {geometry}; this.options = {color: 'green'}; }
    }
    class Stub { constructor() {} }
    const primitives = new Set();
    const globe = {sceneChanged: false, pauseRendering() {}, resumeRendering() {},
        on() {}, setView() {}, getPosition: () => [20, 0], getZoom: () => 2, handleResize() {},
        getCesiumScene: () => ({primitives: {add(p) { primitives.add(p); return p; },
            remove(p) { primitives.delete(p); }}})};
    const WE = {map: () => globe, tileLayer: () => ({addTo() {}}), marker() {
        markerCount++;
        const icon = {parentElement: element()};
        return {addTo() { icons.push(icon); return this; },
            removeFrom() { icons.splice(icons.indexOf(icon), 1); }};
    }};
    const container = element();
    const context = {document: {createElement: element}, window: {WE, Cesium: {
        Cartesian3: {fromDegrees() {}}, Color: {fromCssColorString: () => ({})},
        PolygonHierarchy: Stub, Primitive: Stub, PolygonGeometry: Stub, GeometryInstance: Stub,
        PerInstanceColorAppearance: Stub, ColorGeometryInstanceAttribute: {fromColor() {}},
    }}, WE, LeafletMap, CircleMarker, Marker, Polygon, Polyline, LatLng: Stub,
        ZoomControl: class {addTo() {}}, ResizeObserver: class {observe() {}},
        requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame(id) { frames.delete(id); }, performance: {now: () => 0},
        globePolygonPatches() { clipping++; return [[[[0, 0], [1, 0], [0, 1], [0, 0]]]]; }};
    runInNewContext(`${queueSource}\n${source}\nglobalThis.result = createGlobeMap(container);`,
        Object.assign(context, {container}));
    const map = context.result.map;
    const dock = container.children.find(child => child.className === 'map-view-dock');
    return {map, primitives, frames, Marker, Polygon,
        get markerCount() { return markerCount; }, get scans() { return scans; },
        get clipping() { return clipping; },
        mode(index) { dock.children[index].events.click(); },
        add(layer) { map.layers.add(layer); map.fire('layeradd', {layer}); },
        remove(layer) { map.layers.delete(layer); map.fire('layerremove', {layer}); },
        flush() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } }};
}

test('3D bridge batches marker scans and skips transient layers', () => {
    const app = setup();
    app.mode(1);
    const transient = new app.Marker();
    app.add(transient);
    app.remove(transient);
    for (let i = 0; i < 100; i++) app.add(new app.Marker());
    assert.equal(app.markerCount, 0);
    app.flush();
    assert.equal(app.markerCount, 32);
    assert.equal(app.scans, 1);
    while (app.frames.size) app.flush();
    assert.equal(app.markerCount, 100);
    assert.equal(app.scans, 4);
    app.mode(0);
    app.add(new app.Marker());
    assert.equal(app.frames.size, 0);
});

test('3D bridge reuses clipping on view switches and cancels queued work', () => {
    const app = setup();
    app.add(new app.Polygon({type: 'Polygon', coordinates: []}));
    app.mode(1);
    app.flush();
    assert.equal(app.primitives.size, 1);
    assert.equal(app.clipping, 1);
    app.mode(0);
    assert.equal(app.primitives.size, 0);
    app.mode(1);
    app.flush();
    assert.equal(app.primitives.size, 1);
    assert.equal(app.clipping, 1);
    app.add(new app.Marker());
    app.mode(0);
    assert.equal(app.frames.size, 0);
    assert.equal(app.markerCount, 0);
});
