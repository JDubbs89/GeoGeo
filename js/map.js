import {LeafletMap, TileLayer, GeoJSON} from 'leaflet';
import {createClusterShapes} from './shapes.js';
import {queryPoints} from './data.js';

const formatReading = value => value.toLocaleString(undefined, {maximumSignificantDigits: 4});

const map = new LeafletMap('map').setView([20, 0], 2);
new TileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
const layer = new GeoJSON(null, {
    style: feature => ({color: '#a33623', weight: 1, fillOpacity: 0.15 + feature.properties.score / 200}),
    onEachFeature: (feature, item) => {
        const p = feature.properties;
        item.bindPopup(`<p class="tooltip"><strong>Area averages</strong><br>` +
            `CO₂: ${formatReading(p.c02)} ppm<br>` +
            `CH₄ emissions: ${formatReading(p.ch4)} Mg yr⁻¹ km⁻²<br>` +
            `NO₂: ${formatReading(p.n02)} ppbv</p>`, {minWidth: 300, maxWidth: 420});
    },
}).addTo(map);
const slider = document.getElementById('threshold');
const output = document.getElementById('threshold-value');
const status = document.getElementById('data-status');
let updating = false;
let fitted = false;

async function update() {
    if (updating) return;
    updating = true;
    const value = slider.value;
    try {
        const result = await queryPoints(value);
        layer.clearLayers();
        if (!result.total) {
            //status.textContent = 'No coordinates have all three measurements. Import the aligned data.';
            return;
        }
        const weights = ['c02', 'ch4', 'n02'].map(field => `${(result.weights[field] * 100).toFixed(1)}%`).join(' / ');
        const readings = result.points.length ? [
            ['c02', 'CO₂', 'ppm'],
            ['ch4', 'CH₄ emissions', 'Mg yr⁻¹ km⁻²'],
            ['n02', 'NO₂', 'ppbv'],
        ].map(([field, label, units]) => {
            const [min, max] = result.points.reduce(
                ([low, high], point) => [Math.min(low, point[field]), Math.max(high, point[field])],
                [Infinity, -Infinity]
            );
            return `${label}: ${formatReading(min)}–${formatReading(max)} ${units}`;
        }).join('; ') : 'No matching gas readings.';
        output.textContent = `${readings}`;
        const shapes = createClusterShapes(result.points, result.grid_spacing);
        const shapeCount = shapes.features.length;
        layer.addData(shapes);
        //status.textContent = `${result.points.length} of ${result.total} coordinates; ${shapeCount} shapes.`;
        if (!fitted && layer.getBounds().isValid()) {
            map.fitBounds(layer.getBounds(), {maxZoom: 5});
            fitted = true;
        }
    } catch (error) {
        // If the error is not an AbortError, update the status message
        //if (error.name !== 'AbortError') status.textContent = error.message;
    } finally {
        updating = false;
        // Keep drawing during a drag, then catch up to the most recent value.
        if (slider.value !== value) update();
    }
}
slider.addEventListener('input', update);
update();
