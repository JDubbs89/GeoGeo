import clustering from 'density-clustering';
import concaveman from 'concaveman';

function clusterPoints(points, eps = 0.5, minPts = 5) {
    if (points.some(point => point.length !== 2 || !point.every(Number.isFinite))) {
        throw new Error('Clustering requires finite [longitude, latitude] pairs.');
    }
    // Euclidean distance: eps is in coordinate degrees, not kilometers.
    const clusters = new clustering.DBSCAN().run(points, eps, minPts);
    return clusters.map(indices => indices.map(index => points[index]));
}

function createConcaveHull(points, concavity = 1.5) {
    const uniquePoints = [...new Map(points.map(point => [point.join(','), point])).values()];
    if (uniquePoints.length < 3) return null;
    const ring = concaveman(uniquePoints, concavity);
    const twiceArea = ring.slice(1).reduce((area, point, i) =>
        area + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
    return ring.length >= 4 && Math.abs(twiceArea) > 0 ? ring : null;
}

function aggregatePoints(points) {
    const mean = field => points.reduce((sum, point) => sum + point[field], 0) / points.length;
    const weight = points.reduce((sum, point) => sum + point.score, 0);
    const center = field => weight > 0
        ? points.reduce((sum, point) => sum + point[field] * point.score, 0) / weight
        : mean(field);
    return {pointCount: points.length, score: mean('score'),
        c02: mean('c02'), ch4: mean('ch4'), n02: mean('n02'),
        center: {lat: center('lat'), lon: center('lon')}};
}

function createClusterShapes(records, gridSpacing) {
    const points = records.map(point => [point.lon, point.lat]);
    const byCoordinate = new Map(records.map(point => [[point.lon, point.lat].join(','), point]));
    const eps = Math.hypot(gridSpacing.latitude, gridSpacing.longitude) * 1.01;
    const clusters = clusterPoints(points, eps, 5);
    const features = [];
    for (const cluster of clusters) {
        const ring = createConcaveHull(cluster);
        if (!ring) continue;
        features.push({
            type: 'Feature',
            properties: aggregatePoints(cluster.map(point => byCoordinate.get(point.join(',')))),
            geometry: {type: 'Polygon', coordinates: [ring]},
        });
    }
    return {type: 'FeatureCollection', features};
}

export {clusterPoints, createConcaveHull, createClusterShapes, aggregatePoints};
