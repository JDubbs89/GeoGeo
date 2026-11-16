// Coalesce Leaflet changes before doing expensive globe work, then yield between
// small batches so slider input and camera controls can run during large updates.
export function createGlobeLayerQueue(add, afterFlush = () => {}, {
    requestFrame = requestAnimationFrame,
    cancelFrame = cancelAnimationFrame,
    now = () => performance.now(),
    budgetMs = 8,
    maxPerFrame = 32,
} = {}) {
    const pending = new Set();
    let frame = null;

    function flush() {
        frame = null;
        const start = now();
        let count = 0;
        try {
            while (pending.size) {
                const layer = pending.values().next().value;
                pending.delete(layer);
                add(layer);
                // Primitive upload/triangulation may occur in Cesium's next
                // render, so also cap work that is cheap to enqueue here.
                if (++count >= maxPerFrame || now() - start >= budgetMs) break;
            }
        } finally {
            afterFlush();
            if (pending.size && frame === null) frame = requestFrame(flush);
        }
    }

    return {
        add(layer) {
            pending.add(layer);
            if (frame === null) frame = requestFrame(flush);
        },
        remove(layer) { pending.delete(layer); },
        clear() {
            pending.clear();
            if (frame !== null) cancelFrame(frame);
            frame = null;
        },
    };
}
