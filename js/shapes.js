import clustering from 'density-clustering';
import concaveman from 'concaveman';
import {POLLUTANTS, SEVERITY_LEVELS, getSeverity} from './severity.js';

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
    const mean = field => {
        const values = points.map(point => point[field]).filter(Number.isFinite);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    return {pointCount: points.length,
        c02_rank: mean('c02_rank'), ch4_rank: mean('ch4_rank'), n02_rank: mean('n02_rank'),
        c02: mean('c02'), ch4: mean('ch4'), n02: mean('n02'),
        center: {lat: mean('lat'), lon: mean('lon')}};
}

function createClusterShapes(records, gridSpacing) {
    const points = records.map(point => [point.lon, point.lat]);
    const byCoordinate = new Map(records.map(point => [[point.lon, point.lat].join(','), point]));
    const eps = Math.hypot(gridSpacing.latitude, gridSpacing.longitude) * 1.01;
    const clusters = clusterPoints(points, eps, 5);
    const features = [];
    const represented = new Set();
    for (const cluster of clusters) {
        const ring = createConcaveHull(cluster);
        if (!ring) continue;
        features.push({
            type: 'Feature',
            properties: aggregatePoints(cluster.map(point => byCoordinate.get(point.join(',')))),
            geometry: {type: 'Polygon', coordinates: [ring]},
        });
        for (const point of cluster) represented.add(point.join(','));
    }
    // Isolated or collinear matches cannot form a hull, but must still be shown.
    for (const record of records) {
        if (represented.has([record.lon, record.lat].join(','))) continue;
        features.push({
            type: 'Feature',
            properties: aggregatePoints([record]),
            geometry: {type: 'Point', coordinates: [record.lon, record.lat]},
        });
    }
    return {type: 'FeatureCollection', features};
}

function createPollutantShapes(recordsByPollutant, gridSpacing) {
    return Object.fromEntries(POLLUTANTS.filter(({id}) => Object.hasOwn(recordsByPollutant, id)).map(pollutant => {
        const groups = Object.fromEntries(SEVERITY_LEVELS.map(level => [level.id, []]));
        for (const record of recordsByPollutant[pollutant.id]) {
            groups[getSeverity(record[`${pollutant.id}_rank`]).id].push(record);
        }
        // Preserve each pollutant's amount band when forming polygons.
        return [pollutant.id, {type: 'FeatureCollection', features: SEVERITY_LEVELS.flatMap(level =>
            createClusterShapes(groups[level.id], gridSpacing).features)}];
    }));
}

export {clusterPoints, createConcaveHull, createClusterShapes, createPollutantShapes, aggregatePoints};
