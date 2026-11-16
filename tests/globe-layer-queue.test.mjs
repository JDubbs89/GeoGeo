import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const source = await readFile(new URL('../js/globe-layer-queue.js', import.meta.url), 'utf8');
const {createGlobeLayerQueue} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function setup(cost = 1) {
    let time = 0, frameId = 0, scans = 0;
    const frames = new Map(), added = [];
    const queue = createGlobeLayerQueue(layer => { added.push(layer); time += cost; },
        () => scans++, {now: () => time, requestFrame(callback) {
            frames.set(++frameId, callback); return frameId;
        }, cancelFrame(id) { frames.delete(id); }});
    return {queue, added, frames, get scans() { return scans; },
        flush() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); }};
}

test('discard replaced layers before any globe geometry is constructed', () => {
    const app = setup();
    for (let i = 0; i < 1000; i++) { app.queue.add(i); app.queue.remove(i); }
    app.queue.add('latest');
    app.queue.add('latest');
    assert.equal(app.added.length, 0);
    assert.equal(app.frames.size, 1);
    app.flush();
    assert.deepEqual(app.added, ['latest']);
    assert.equal(app.frames.size, 0);
});

test('large updates yield after the frame budget and scan markers once per batch', () => {
    const app = setup(2);
    for (let i = 0; i < 10; i++) app.queue.add(i);
    app.flush();
    assert.deepEqual(app.added, [0, 1, 2, 3]);
    assert.equal(app.scans, 1);
    app.queue.remove(4);
    app.flush();
    assert.deepEqual(app.added, [0, 1, 2, 3, 5, 6, 7, 8]);
    app.flush();
    assert.equal(app.added.at(-1), 9);
    assert.equal(app.scans, 3);
    assert.equal(app.frames.size, 0);
});

test('leaving 3D cancels unfinished work', () => {
    const app = setup(8);
    app.queue.add('first');
    app.queue.add('second');
    app.flush();
    app.queue.clear();
    assert.deepEqual(app.added, ['first']);
    assert.equal(app.frames.size, 0);
    app.queue.add('new view');
    app.flush();
    assert.deepEqual(app.added, ['first', 'new view']);
});
