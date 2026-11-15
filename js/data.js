import {queryPoints} from './api-data.js';
export {queryPoints};

// Use observed measurements rather than treating a percentile as a physical unit.
export async function sliderReadings(sliders) {
    const ids = ['c02', 'ch4', 'n02'];
    const result = await queryPoints(ids.map(id => sliders[id]).join(','));
    return Object.fromEntries(ids.map(id => {
        const closest = result.layers[id].reduce((best, point) => {
            if (!Number.isFinite(point[id]) || !Number.isFinite(point[`${id}_rank`])) return best;
            const error = Math.abs(point[`${id}_rank`] - sliders[id]);
            const bestError = best ? Math.abs(best[`${id}_rank`] - sliders[id]) : Infinity;
            return error < bestError ? point : best;
        }, null);
        return [id, closest?.[id] ?? null];
    }));
}
