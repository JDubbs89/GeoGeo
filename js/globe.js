import {globePolygonPatches} from './globe-geometry.js';
import {LeafletMap, Polygon, Polyline, CircleMarker, Marker, LatLng, ZoomControl} from 'leaflet';

// Leaflet owns the layers and controls; WebGL Earth renders their geometry.
export function createGlobeMap(container) {
    const model = document.createElement('div');
    model.className = 'globe-model';
    const viewport = document.createElement('div');
    viewport.className = 'globe-viewport';
    container.append(model, viewport);
    container.dataset.viewMode = '2d';
    const map = new LeafletMap(model, {zoomControl: false}).setView([20, 0], 2);
    map.viewMode = '2d';
    map.createPane('game-path').style.zIndex = 450;
    map.createPane('game-markers').style.zIndex = 650;
    new ZoomControl().addTo(map);
    const dock = document.createElement('div');
    dock.className = 'map-view-dock';
    dock.setAttribute('role', 'group');
    dock.setAttribute('aria-label', 'Map view');
    const viewButtons = ['2d', '3d'].map(mode => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = mode.toUpperCase();
        button.setAttribute('aria-label', `${mode.toUpperCase()} map`);
        button.setAttribute('aria-pressed', String(mode === '2d'));
        dock.append(button);
        return button;
    });
    const soundControls = container.closest('.left-area')?.querySelector('.playSound');
    if (soundControls) {
        const bottomControls = document.createElement('div');
        bottomControls.className = 'map-bottom-controls';
        bottomControls.append(dock, soundControls);
        container.append(bottomControls);
    } else {
        container.append(dock);
    }
    const probe = document.createElement('canvas');
    const supported = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    supported?.getExtension('WEBGL_lose_context')?.loseContext();
    if (!window.WE || !supported) {
        model.classList.add('globe-fallback');
        viewButtons[1].disabled = true;
        viewButtons[1].title = '3D is unavailable in this browser';
        const notice = document.createElement('p');
        notice.className = 'globe-notice';
        notice.textContent = '3D globe unavailable. Showing the flat map.';
        container.append(notice);
        return {map, globe: null};
    }
    const globe = WE.map(viewport, {center: [20, 0], zoom: 2, sky: true});
    WE.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(globe);
    viewport.style.position = 'absolute';
    const C = window.Cesium;
    const scene = globe.getCesiumScene();
    const visuals = new Map();
    globe.pauseRendering();
    const changed = () => { globe.sceneChanged = true; };
    const position = point => C.Cartesian3.fromDegrees(point.lng, point.lat, 100);
    const color = (value, alpha = 1) => {
        const result = C.Color.fromCssColorString(value);
        result.alpha = alpha;
        return result;
    };
    function remove(layer) {
        const visual = visuals.get(layer);
        if (!visual) return;
        activePopup?.removeFrom(globe);
        activePopup = null;
        visual.dispose();
        visuals.delete(layer);
        changed();
    }
    function add(layer) {
        if (map.viewMode !== '3d' || visuals.has(layer)) return;
        if (layer instanceof CircleMarker || layer instanceof Marker) {
            const point = layer.getLatLng();
            const circle = layer instanceof CircleMarker;
            const radius = layer.options.radius || 8;
            const svg = circle
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="${radius * 2 + 4}" height="${radius * 2 + 4}"><circle cx="${radius + 2}" cy="${radius + 2}" r="${radius}" fill="${layer.options.fillColor || layer.options.color}" fill-opacity="${layer.options.fillOpacity ?? 0.3}" stroke="${layer.options.color}" stroke-width="2"/></svg>`
                : '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42"><path d="M15 41C12 32 2 24 2 15a13 13 0 0 1 26 0c0 9-10 17-13 26Z" fill="#0077cc" stroke="white" stroke-width="2"/></svg>';
            const marker = WE.marker([point.lat, point.lng],
                `data:image/svg+xml,${encodeURIComponent(svg)}`, circle ? radius * 2 + 4 : 30, circle ? radius * 2 + 4 : 42).addTo(globe);
            const icons = viewport.querySelectorAll('.we-pm-icon');
            const markerElement = icons[icons.length - 1]?.parentElement;
            markerElement?.classList.add(layer.options.pane === 'game-markers' ? 'globe-game-marker' : 'globe-pollutant-marker');
            const popup = layer.getPopup();
            if (popup) marker.bindPopup(popup.getContent(), {maxWidth: 420});
            const tooltip = layer.getTooltip();
            if (tooltip) marker.bindPopup(tooltip.getContent(), {maxWidth: 120}).openPopup();
            const move = () => { marker.setLatLng(layer.getLatLng()); changed(); };
            layer.on('move', move);
            let stopDrag = () => {};
            if (layer.options.interactive === false) marker.on('click', () => {
                map.fire('click', {latlng: layer.getLatLng()});
            });
            if (!circle && layer.options.draggable) {
                marker.on('pointerdown', event => {
                    if (!layer.dragging.enabled()) return;
                    event.originalEvent.preventDefault();
                    event.originalEvent.stopPropagation();
                    const controller = scene.screenSpaceCameraController;
                    controller.enableInputs = false;
                    const drag = event => {
                        const bounds = viewport.getBoundingClientRect();
                        const hit = scene.camera.pickEllipsoid(new C.Cartesian2(event.clientX - bounds.left, event.clientY - bounds.top));
                        if (!hit) return;
                        const point = C.Ellipsoid.WGS84.cartesianToCartographic(hit);
                        layer.setLatLng([C.Math.toDegrees(point.latitude), C.Math.toDegrees(point.longitude)]);
                    };
                    stopDrag = () => {
                        document.removeEventListener('pointermove', drag);
                        document.removeEventListener('pointerup', stopDrag);
                        controller.enableInputs = true;
                        stopDrag = () => {};
                        layer.fire('dragend');
                    };
                    document.addEventListener('pointermove', drag);
                    document.addEventListener('pointerup', stopDrag, {once: true});
                });
            }
            visuals.set(layer, {dispose() {stopDrag(); layer.off('move', move); marker.removeFrom(globe);}});
        } else if (layer instanceof Polygon) {
            const json = layer.toGeoJSON().geometry;
            const polygons = globePolygonPatches(json);
            const hierarchy = rings => new C.PolygonHierarchy(
                rings[0].slice(0, -1).map(([lng, lat]) => position({lng, lat})),
                rings.slice(1).map(ring => hierarchy([ring])));
            const primitive = scene.primitives.add(new C.Primitive({
                geometryInstances: polygons.map(rings => new C.GeometryInstance({
                    id: layer,
                    geometry: new C.PolygonGeometry({polygonHierarchy: hierarchy(rings), height: 100,
                        vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT}),
                    attributes: {color: C.ColorGeometryInstanceAttribute.fromColor(color(layer.options.fillColor || layer.options.color, layer.options.fillOpacity))},
                })),
                appearance: new C.PerInstanceColorAppearance({closed: true, translucent: true, flat: true}),
                asynchronous: false,
            }));
            visuals.set(layer, {dispose() {scene.primitives.remove(primitive);}});
        } else if (layer instanceof Polyline) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('globe-path-layer');
            const path = document.createElementNS(svg.namespaceURI, 'path');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', layer.options.color);
            path.setAttribute('stroke-width', layer.options.weight || 3);
            if (layer.options.dashArray) path.setAttribute('stroke-dasharray', layer.options.dashArray);
            svg.append(path);
            viewport.append(svg);
            const points = layer.getLatLngs();
            const positions = [];
            for (let i = 1; i < points.length; i++) {
                if (points[i - 1].equals(points[i])) continue;
                const arc = new C.EllipsoidGeodesic(
                    C.Cartographic.fromDegrees(points[i - 1].lng, points[i - 1].lat),
                    C.Cartographic.fromDegrees(points[i].lng, points[i].lat));
                for (let step = 0; step <= 128; step++) {
                    const point = arc.interpolateUsingFraction(step / 128);
                    point.height = 1000;
                    positions.push(C.Ellipsoid.WGS84.cartographicToCartesian(point));
                }
            }
            // Draw above pollutant DOM markers, while clipping the far side of Earth.
            const updatePath = () => {
                const occluder = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, scene.camera.positionWC);
                let drawing = false;
                const commands = [];
                for (const point of positions) {
                    const pixel = C.SceneTransforms.wgs84ToWindowCoordinates(scene, point);
                    if (!pixel || !occluder.isPointVisible(point)) {
                        drawing = false;
                        continue;
                    }
                    commands.push(`${drawing ? 'L' : 'M'}${pixel.x},${pixel.y}`);
                    drawing = true;
                }
                path.setAttribute('d', commands.join(' '));
            };
            const stopUpdating = scene.postRender.addEventListener(updatePath);
            visuals.set(layer, {dispose() {stopUpdating(); svg.remove();}});
        }
        changed();
    }
    map.on('layeradd', event => add(event.layer));
    map.on('layerremove', event => remove(event.layer));
    globe.on('click', event => {
        if (map.viewMode !== '3d' || !event.latlng) return; // Clicks in space are not guesses.
        map.fire('click', {latlng: new LatLng(event.latitude, event.longitude)});
        const hit = scene.pick(new C.Cartesian2(event.offsetX, event.offsetY));
        const layer = hit?.id;
        if (layer?.options.interactive && layer.getPopup?.()) {
            const popup = WE.marker([event.latitude, event.longitude]).addTo(globe);
            popup.bindPopup(layer.getPopup().getContent(), {maxWidth: 420}).openPopup();
            activePopup?.removeFrom(globe);
            activePopup = popup;
        }
    });
    let activePopup = null;
    const fitBounds = map.fitBounds.bind(map);
    map.fitBounds = (bounds, options = {}) => {
        fitBounds(bounds, options);
        const center = map.getCenter();
        // Leaflet computes a padded fit and maxZoom; use the same camera target.
        if (map.viewMode === '3d') globe.setView([center.lat, center.lng], Math.max(1, map.getZoom()));
        changed();
        return map;
    };
    const controls = model.querySelector('.leaflet-control-container');
    container.append(controls);
    const zoom = document.createElement('div');
    zoom.className = 'globe-zoom';
    for (const [label, title, action] of [['+', 'Zoom in', () => globe.zoomIn()], ['−', 'Zoom out', () => globe.zoomOut()], ['↺', 'Reset globe', () => globe.setView([20, 0], 2)]]) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = label; button.title = title;
        button.setAttribute('aria-label', title); button.addEventListener('click', action);
        zoom.append(button);
    }
    container.append(zoom);
    function setViewMode(mode) {
        if (mode === map.viewMode) return;
        if (mode === '2d') {
            const [lat, lng] = globe.getPosition();
            map.setView([lat, lng], Math.round(globe.getZoom()));
            globe.pauseRendering();
        }
        map.viewMode = mode;
        container.dataset.viewMode = mode;
        for (const button of viewButtons) {
            button.setAttribute('aria-pressed', String(button.textContent.toLowerCase() === mode));
        }
        for (const layer of [...visuals.keys()]) remove(layer);
        // Rebuild only the world copies appropriate to the selected projection.
        map.fire('viewmodechange', {mode});
        if (mode === '3d') {
            const center = map.getCenter();
            globe.handleResize();
            globe.setView([center.lat, center.lng], Math.max(1, map.getZoom()));
            map.eachLayer(add);
            globe.resumeRendering();
        } else {
            map.invalidateSize();
        }
    }
    viewButtons.forEach((button, index) => {
        button.addEventListener('click', () => setViewMode(index === 0 ? '2d' : '3d'));
    });
    new ResizeObserver(() => {map.invalidateSize(); globe.handleResize();}).observe(container);
    return {map, globe};
}
