const pollutants = ['c02', 'ch4', 'n02'];
let snapshotPromise;

function loadSnapshot() {
    snapshotPromise ??= fetch(new URL('../data/points.json', import.meta.url))
        .then(response => {
            if (!response.ok) throw new Error('Unable to load pollutant measurements.');
            return response.json();
        }).catch(error => {
            snapshotPromise = null;
            throw error;
        });
    return snapshotPromise;
}

export async function queryPoints(slider, signal) {
    const values = String(slider).split(',').map(value => value.trim() === '' ? NaN : Number(value));
    if (values.length !== 3 || values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
        throw new Error('Each slider must be between 0 and 100.');
    }
    signal?.throwIfAborted();
    const snapshot = await loadSnapshot();
    signal?.throwIfAborted();
    const sliders = Object.fromEntries(pollutants.map((id, i) => [id, values[i]]));
    const bands = Object.fromEntries(pollutants.map(id => [id, {
        lower: Math.max(0, sliders[id] - snapshot.band_half_width),
        upper: Math.min(100, sliders[id] + snapshot.band_half_width),
    }]));
    const layers = Object.fromEntries(pollutants.map(id => [id,
        snapshot.layers[id].filter(point => point[`${id}_rank`] >= bands[id].lower &&
            point[`${id}_rank`] <= bands[id].upper),
    ]));
    return {layers, sliders, bands, total: snapshot.total, grid_spacing: snapshot.grid_spacing};
}
