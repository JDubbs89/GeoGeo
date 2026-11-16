import polygonClipping from 'polygon-clipping';

// The legacy globe triangulates on one tangent plane. Keep each patch local,
// preserving the longitude/latitude footprint used by the Leaflet map.
export function globePolygonPatches(geometry) {
    const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
    const patches = [];
    for (const rings of polygons) {
        const longitudes = rings[0].map(point => point[0]);
        const latitudes = rings[0].map(point => point[1]);
        const west = Math.min(...longitudes), east = Math.max(...longitudes);
        const south = Math.max(-90, Math.min(...latitudes));
        const north = Math.min(90, Math.max(...latitudes));
        for (let x = Math.floor(west / 60) * 60; x < east; x += 60) {
            for (let y = Math.floor(south / 60) * 60; y < north; y += 60) {
                const clipped = polygonClipping.intersection(rings, [[
                    [x, y], [x + 60, y], [x + 60, Math.min(90, y + 60)],
                    [x, Math.min(90, y + 60)], [x, y],
                ]]);
                for (const polygon of clipped) patches.push(polygon.map(densifyRing));
            }
        }
    }
    return patches;
}

function densifyRing(ring) {
    const points = [];
    for (let i = 1; i < ring.length; i++) {
        const start = ring[i - 1], end = ring[i];
        // Short edges follow the data footprint rather than bowing across a cell.
        const steps = Math.ceil(Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])));
        for (let step = 0; step < steps; step++) {
            const fraction = step / steps;
            points.push([start[0] + (end[0] - start[0]) * fraction,
                start[1] + (end[1] - start[1]) * fraction]);
        }
    }
    if (points.length) points.push([...points[0]]);
    return points;
}
