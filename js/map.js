import {LeafletMap, TileLayer, GeoJSON, CircleMarker, LayersControl, FeatureGroup} from 'leaflet';
import {createPollutantShapes} from './shapes.js';
import {POLLUTANTS, SEVERITY_LEVELS, getSeverity, pollutantColor} from './severity.js';
import {queryPoints} from './data.js';

const formatReading = (value) => Number.isFinite(value) ? value.toLocaleString(undefined, {maximumSignificantDigits: 4}) : 'No reading';

const map = new LeafletMap('map').setView([20, 0], 2);
new TileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
const pollutantLayers = Object.fromEntries(POLLUTANTS.map((pollutant, index) => [pollutant.id, new GeoJSON(null, {
    style: feature => ({color: pollutantColor(pollutant, feature.properties[`${pollutant.id}_rank`]),
        weight: 1, fillOpacity: 0.3}),
    pointToLayer: (feature, latlng) => new CircleMarker(latlng, {radius: 8 - index * 2}),
    onEachFeature: (feature, item) => {
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

    if (!c02Slider || !ch4Slider || !n02Slider || !output) {
        console.error('Map controls are missing from the page.');
        return;
    }

    document.getElementById('show-all-layers').addEventListener('click', () => {
        for (const layer of Object.values(pollutantLayers)) layer.addTo(map);
    });

    let updating = false;
    let fitted = false;

    async function update() {
    if (updating) return;
    updating = true;
    const c02Value = c02Slider.value;
    const ch4Value = ch4Slider.value;
    const n02Value = n02Slider.value;
    try {
        const result = await queryPoints(c02Value + ',' + ch4Value + ',' + n02Value);
        for (const layer of Object.values(pollutantLayers)) layer.clearLayers();
        if (!result.total) {
            output.textContent = 'No pollutant measurements are available. Import the data.';
            return;
        }
        const summaries = POLLUTANTS.map(pollutant => {
            const records = result.layers[pollutant.id];
            const units = {c02: 'ppm', ch4: 'Mg yr⁻¹ km⁻²', n02: 'ppbv'};
            const range = records.length ? (() => {
                const [min, max] = records.reduce(([low, high], record) =>
                    [Math.min(low, record[pollutant.id]), Math.max(high, record[pollutant.id])],
                    [Infinity, -Infinity]);
                return `${formatReading(min)}–${formatReading(max)} ${units[pollutant.id]}`;
            })() : 'No matching readings';
            const scale = pollutant.id === 'ch4' ? 'positive-emission percentile band' : 'percentile band';
            const band = result.bands[pollutant.id];
            return `${pollutant.label}: ${scale} ${band.lower}–${band.upper}%; ${records.length} locations; ${range}`;
        });
        output.textContent = summaries.join(' — ');
        const shapes = createPollutantShapes(result.layers, result.grid_spacing);
        for (const pollutant of POLLUTANTS) pollutantLayers[pollutant.id].addData(shapes[pollutant.id]);
        const bounds = allLayers.getBounds();
        if (!fitted && bounds.isValid()) {
            map.fitBounds(bounds, {maxZoom: 5});
            fitted = true;
        }
    } catch (error) {
        output.textContent = `Unable to update the map: ${error.message}`;
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
