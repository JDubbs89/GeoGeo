import {TileLayer, GeoJSON, CircleMarker, LayersControl, FeatureGroup} from 'leaflet';
import {createGlobeMap} from './globe.js';
import {createPollutantShapes} from './shapes.js';
import {POLLUTANTS, SEVERITY_LEVELS, getSeverity, pollutantColor} from './severity.js';
import {queryPoints} from './data.js';

const formatReading = (value) => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumSignificantDigits: 4}) : 'No reading';
const formatBandReading = value => value.toExponential(2);

const guessing = document.getElementById('map').hasAttribute('data-guess-map');

export const {map, globe} = createGlobeMap(document.getElementById('map'));
new TileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
const pollutantLayers = Object.fromEntries(POLLUTANTS.map((pollutant, index) => [pollutant.id, new GeoJSON(null, {
    // Pass clicks through pollutant shapes when choosing a game location.
    interactive: !guessing,
    style: feature => ({color: pollutantColor(pollutant, feature.properties[`${pollutant.id}_rank`]),
        weight: 1, fillOpacity: 0.3}),
    pointToLayer: (feature, latlng) => new CircleMarker(latlng, {radius: 8 - index * 2, interactive: !guessing}),
    onEachFeature: (feature, item) => {
        if (guessing) return;
        const p = feature.properties;
        const title = p.pointCount === 1 ? 'Location readings' : 'Area averages';
        item.bindPopup(`<p class="tooltip"><strong>${title}</strong><br>` +
            `${pollutant.label}: ${getSeverity(p[`${pollutant.id}_rank`]).label} · ${pollutant.id === 'ch4' ? 'Positive-emission percentile' : 'Percentile'}: ${formatReading(p[`${pollutant.id}_rank`])}%<br>` +
            `CO₂: ${formatReading(p.c02)} ppm<br>` +
            `CH₄ emissions: ${formatReading(p.ch4)} Mg yr⁻¹ km⁻²<br>` +
            `NO₂: ${formatReading(p.n02)} ppbv</p>`, {minWidth: 300, maxWidth: 420});
    },
})]));
for (const layer of Object.values(pollutantLayers)) layer.addTo(map);
const layerChoices = Object.fromEntries(POLLUTANTS.map(pollutant => [
    `${pollutant.label} ${pollutant.shades.map((color, i) =>
        `<span title="${SEVERITY_LEVELS[i].label}: ${SEVERITY_LEVELS[i].min}–${SEVERITY_LEVELS[i].max}%" style="color: ${color}">■</span>`
    ).join('')}`,
    pollutantLayers[pollutant.id],
]));
new LayersControl({}, layerChoices, {collapsed: false}).addTo(map);
const allLayers = new FeatureGroup(Object.values(pollutantLayers));

function initializeControls() {
    const c02Slider = document.getElementById('c02-threshold');
    const ch4Slider = document.getElementById('ch4-threshold');
    const n02Slider = document.getElementById('n02-threshold');
    const output = document.getElementById('threshold-value');
    const bandOutputs = Object.fromEntries(POLLUTANTS.map(({id}) =>
        [id, document.getElementById(`${id}-band`)]));

    if (!c02Slider || !ch4Slider || !n02Slider || !output || Object.values(bandOutputs).some(item => !item)) {
        console.error('Map controls are missing from the page.');
        return;
    }

    let updating = false;
    let fitted = false;
    let currentShapes = null;
    let renderedWorlds = '';

    // Tiles repeat every 360 degrees; GeoJSON needs its own shifted copies.
    function shiftCoordinates(coordinates, offset) {
        if (typeof coordinates[0] === 'number') {
            return [coordinates[0] + offset, ...coordinates.slice(1)];
        }
        return coordinates.map(part => shiftCoordinates(part, offset));
    }

    function renderWorldCopies() {
        if (!currentShapes) return;
        const bounds = map.getBounds();
        const firstWorld = map.viewMode === '3d' ? 0 : Math.floor((bounds.getWest() + 180) / 360);
        const lastWorld = map.viewMode === '3d' ? 0 : Math.floor((bounds.getEast() + 180) / 360);
        const worlds = `${firstWorld},${lastWorld}`;
        if (worlds === renderedWorlds) return;
        renderedWorlds = worlds;

        for (const pollutant of POLLUTANTS) {
            const layer = pollutantLayers[pollutant.id];
            layer.clearLayers();
            for (let world = firstWorld; world <= lastWorld; world++) {
                const collection = currentShapes[pollutant.id];
                layer.addData({...collection, features: collection.features.map(feature => ({
                    ...feature,
                    geometry: {...feature.geometry,
                        coordinates: shiftCoordinates(feature.geometry.coordinates, world * 360)},
                }))});
            }
        }
    }

    // Reuse the generated shapes when panning instead of querying or clustering again.
    map.on('moveend viewmodechange', renderWorldCopies);

    async function update() {
    // Percentiles select the band; its displayed range comes from real measurements.
    for (const {id} of POLLUTANTS) {
        bandOutputs[id].textContent = 'Loading…';
        bandOutputs[id].setAttribute('aria-busy', 'true');
    }
    if (updating) return;
    updating = true;
    const c02Value = c02Slider.value;
    const ch4Value = ch4Slider.value;
    const n02Value = n02Slider.value;
    try {
        const result = await queryPoints(c02Value + ',' + ch4Value + ',' + n02Value);
        // Do not show measurements from an older slider position during a drag.
        if (c02Slider.value !== c02Value || ch4Slider.value !== ch4Value || n02Slider.value !== n02Value) return;
        for (const {id} of POLLUTANTS) {
            const readings = result.layers[id].map(record => record[id]).filter(Number.isFinite);
            if (readings.length) {
                const [min, max] = readings.reduce(([low, high], value) =>
                    [Math.min(low, value), Math.max(high, value)], [Infinity, -Infinity]);
                const range = min === max ? formatBandReading(min) : `${formatBandReading(min)}–${formatBandReading(max)}`;
                bandOutputs[id].textContent = range;
            } else {
                bandOutputs[id].textContent = 'No readings';
            }
            bandOutputs[id].setAttribute('aria-busy', 'false');
        }
        currentShapes = null;
        renderedWorlds = '';
        for (const layer of Object.values(pollutantLayers)) layer.clearLayers();
        if (!result.total) {
            output.textContent = 'No pollutant measurements are available. Import the data.';
            output.hidden = false;
            return;
        }
        output.textContent = '';
        output.hidden = true;
        const shapes = createPollutantShapes(result.layers, result.grid_spacing);
        for (const pollutant of POLLUTANTS) pollutantLayers[pollutant.id].addData(shapes[pollutant.id]);
        const bounds = allLayers.getBounds();
        if (!fitted && bounds.isValid()) {
            map.fitBounds(bounds, {maxZoom: 5});
            fitted = true;
        }
        // Fit the original data first so repeated copies do not widen the initial view.
        currentShapes = shapes;
        renderWorldCopies();
    } catch (error) {
        for (const {id} of POLLUTANTS) {
            bandOutputs[id].textContent = 'Unavailable';
            bandOutputs[id].setAttribute('aria-busy', 'false');
        }
        output.textContent = `Unable to update the map: ${error.message}`;
        output.hidden = false;
        console.error('Unable to update the map:', error);
    } finally {
        updating = false;
        // Keep drawing during a drag, then catch up to the most recent value.
        if (c02Slider.value !== c02Value || ch4Slider.value !== ch4Value || n02Slider.value !== n02Value) update();
    }
    }

    c02Slider.addEventListener('input', update);
    ch4Slider.addEventListener('input', update);
    n02Slider.addEventListener('input', update);
    update();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeControls, {once: true});
} else {
    initializeControls();
}
