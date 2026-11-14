import {LeafletMap, TileLayer, CircleMarker} from 'leaflet';
import {loadCO2Data} from './data.js';

const map = new LeafletMap('map').setView([51.505, -0.09], 13);

const tileLayer = new TileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

tileLayer.addTo(map);

const status = document.getElementById('data-status');

try {
    const payload = await loadCO2Data();
    for (const point of payload.Data) {
        const {lat, lng} = point.coords;
        const precision = point.CO2Precision === null
            ? 'Unavailable'
            : `${point.CO2Precision.toFixed(2)} ppm`;
        new CircleMarker([lat, lng], {
            radius: 3,
            weight: 1,
            color: '#a33623',
            fillOpacity: 0.6,
        }).bindPopup(
            `${lat.toFixed(3)}, ${lng.toFixed(3)}<br>` +
            `CO₂: ${point.C02Level.toFixed(2)} ppm<br>` +
            `Precision: ${precision}<br>${payload.date}`
        ).addTo(map);
    }
    status.textContent = `${payload.date}: ${payload.Data.length.toLocaleString()} grid points loaded (ppm).`;
} catch (error) {
    status.textContent = error.message;
}
