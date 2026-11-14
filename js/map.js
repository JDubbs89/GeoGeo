import {LeafletMap, TileLayer} from 'leaflet';

const map = new LeafletMap('map').setView([51.505, -0.09], 13);

const tileLayer = new TileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

tileLayer.addTo(map);