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

    const sliders = {c02: c02Slider, ch4: ch4Slider, n02: n02Slider};
    const updating = new Set();
    const errors = new Map();
    let initialized = false;
    let fitted = false;
    const currentShapes = {};
    const renderedWorlds = {};

    // Tiles repeat every 360 degrees; GeoJSON needs its own shifted copies.
    function shiftCoordinates(coordinates, offset) {
        if (typeof coordinates[0] === 'number') {
            return [coordinates[0] + offset, ...coordinates.slice(1)];
        }
        return coordinates.map(part => shiftCoordinates(part, offset));
    }

    function renderWorldCopies() {
        const bounds = map.getBounds();
        const firstWorld = map.viewMode === '3d' ? 0 : Math.floor((bounds.getWest() + 180) / 360);
        const lastWorld = map.viewMode === '3d' ? 0 : Math.floor((bounds.getEast() + 180) / 360);
        const worlds = `${firstWorld},${lastWorld}`;
        for (const pollutant of POLLUTANTS) {
            if (!currentShapes[pollutant.id] || renderedWorlds[pollutant.id] === worlds) continue;
            renderedWorlds[pollutant.id] = worlds;
            const layer = pollutantLayers[pollutant.id];
            layer.clearLayers();
            for (let world = firstWorld; world <= lastWorld; world++) {
                const collection = currentShapes[pollutant.id];
                if (world === 0) {
                    layer.addData(collection);
                    continue;
                }
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

    function fitInitialBounds() {
        if (fitted) return;
        const bounds = allLayers.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, {maxZoom: 5});
            fitted = true;
        }
    }

    function showStatus() {
        output.textContent = [...errors.values()].join(' ');
        output.hidden = errors.size === 0;
    }

    async function update(id, initialResult) {
        // Serialize and coalesce drags independently for each pollutant.
        if (updating.has(id)) return;
        updating.add(id);
        const value = sliders[id].value;
        bandOutputs[id].textContent = 'Loading…';
        bandOutputs[id].setAttribute('aria-busy', 'true');
        try {
            const result = await (initialResult ?? queryPoints(
                POLLUTANTS.map(({id}) => sliders[id].value).join(','), undefined, id));
            if (sliders[id].value !== value) return;
            const readings = result.layers[id].map(record => record[id]).filter(Number.isFinite);
            if (readings.length) {
                const [min, max] = readings.reduce(([low, high], reading) =>
                    [Math.min(low, reading), Math.max(high, reading)], [Infinity, -Infinity]);
                bandOutputs[id].textContent = min === max ? formatBandReading(min) :
                    `${formatBandReading(min)}–${formatBandReading(max)}`;
            } else {
                bandOutputs[id].textContent = 'No readings';
            }
            const shapes = createPollutantShapes({[id]: result.layers[id]}, result.grid_spacing);
            currentShapes[id] = shapes[id];
            delete renderedWorlds[id];
            if (!initialized || !fitted) {
                // Only the initial fit needs an intermediate, unshifted layer.
                pollutantLayers[id].clearLayers();
                pollutantLayers[id].addData(shapes[id]);
                renderedWorlds[id] = '0,0';
            }
            if (initialized) {
                fitInitialBounds();
                renderWorldCopies();
            }
            errors.delete(id);
            if (!result.total) errors.set(id, 'No pollutant measurements are available. Import the data.');
            showStatus();
        } catch (error) {
            if (sliders[id].value !== value) return;
            bandOutputs[id].textContent = 'Unavailable';
            errors.set(id, `Unable to update ${POLLUTANTS.find(p => p.id === id).label}: ${error.message}`);
            showStatus();
            console.error('Unable to update the map:', error);
        } finally {
            updating.delete(id);
            if (sliders[id].value !== value) {
                update(id);
            } else {
                bandOutputs[id].setAttribute('aria-busy', 'false');
            }
        }
    }

    for (const {id} of POLLUTANTS) sliders[id].addEventListener('input', () => update(id));
    // Share one full query on load; later requests contain only the changed layer.
    const initialResult = queryPoints(POLLUTANTS.map(({id}) => sliders[id].value).join(','));
    Promise.all(POLLUTANTS.map(({id}) => update(id, initialResult))).then(() => {
        initialized = true;
        fitInitialBounds();
        renderWorldCopies();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeControls, {once: true});
} else {
    initializeControls();
}
