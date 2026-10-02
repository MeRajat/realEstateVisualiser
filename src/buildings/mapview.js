// Satellite map overlay for the society: real imagery with the site, towers, amenities, gate
// and approach road drawn on top, nearby places as pins, rotation + compass, and Google Maps
// directions. Lazy-loaded the first time "Map" is opened.
import L from '../customer/leaflet-global.js';
import 'leaflet-rotate';
import 'leaflet/dist/leaflet.css';
import { society } from './society.js';
import { towers } from './model.js';
import { siteRect, siteToLatLng, gateLatLng, placeFrom, directionsTo, directionsBetween } from './geo.js';
import { KINDS } from '../shared/place-kinds.js';
import { boundary as plotBoundary, toLatLng as plotToLatLng, SITE as PLOT_SITE } from '../shared/site.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function createMapOverlay({ root, places = [], onClose }) {
    root.innerHTML = `
        <div class="mo-map" id="mo-map"></div>
        <header class="mo-bar">
            <button type="button" class="mo-btn" data-mo="close" aria-label="Back to 3D">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <span>3D view</span>
            </button>
            <a class="mo-btn mo-primary" href="${directionsTo(gateLatLng())}" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 11 22 2l-9 19-2-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                <span>Get directions</span>
            </a>
        </header>
        <div class="mo-controls">
            <button type="button" data-mo="zoom-in" aria-label="Zoom in">+</button>
            <button type="button" data-mo="zoom-out" aria-label="Zoom out">−</button>
            <button type="button" data-mo="rotate-left" aria-label="Rotate left"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5H4v4M4.6 8.6A8 8 0 1 1 4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
            <button type="button" data-mo="rotate-right" aria-label="Rotate right"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M16 5h4v4M19.4 8.6A8 8 0 1 0 20 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
            <button type="button" data-mo="fit-all" aria-label="Show all nearby places"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        </div>
        <button type="button" class="mo-compass" data-mo="north" aria-label="Point map north"><span>N</span></button>`;

    const map = L.map(root.querySelector('#mo-map'), {
        zoomControl: false, attributionControl: true, zoomSnap: 0.25, maxZoom: 20,
        rotate: true, touchRotate: true, shiftKeyRotate: true, rotateControl: false, bearing: 0,
    });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20, maxNativeZoom: 18, attribution: 'Imagery © Esri · Places © OpenStreetMap',
    }).addTo(map);

    // ─── The society ─────────────────────────────────
    const { site } = society;
    const outline = siteRect({ x: 0, z: 0, w: site.width, d: site.depth });
    L.polygon(outline, { color: '#ffffff', weight: 2.5, dashArray: '8 5', fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
    society.roads.forEach(r => L.polygon(siteRect(r), { stroke: false, fillColor: '#5f6368', fillOpacity: 0.75, interactive: false }).addTo(map));
    if (society.approach) {
        const g = society.gate;
        const a = society.approach;
        L.polygon(siteRect({ x: g.x, z: site.depth / 2 + a.length / 2, w: a.width, d: a.length }),
            { stroke: false, fillColor: '#5f6368', fillOpacity: 0.85, interactive: false }).addTo(map);
    }
    towers.forEach(t => {
        const sideways = t.rotation % 180 !== 0;
        const w = sideways ? t.footprint.d : t.footprint.w;
        const d = sideways ? t.footprint.w : t.footprint.d;
        L.polygon(siteRect({ x: t.x, z: t.z, w, d }), { color: '#174ea6', weight: 1.5, fillColor: '#4285f4', fillOpacity: 0.75 })
            .bindTooltip(`${esc(t.name)} · ${t.floors} floors`, { direction: 'top', className: 'mo-tip' })
            .addTo(map);
        L.marker(siteToLatLng(t.x, t.z), { interactive: false, icon: L.divIcon({ className: 'mo-label', html: `<span>${esc(t.id)}</span>`, iconSize: [30, 20] }) }).addTo(map);
    });
    society.amenities.forEach(a => {
        const fill = a.kind === 'pool' ? '#4fc3f7' : a.kind === 'garden' ? '#34a853' : a.kind === 'parking' ? '#9aa0a6' : '#fbbc04';
        L.polygon(siteRect(a), { stroke: false, fillColor: fill, fillOpacity: 0.7 })
            .bindTooltip(`${a.icon || ''} ${esc(a.name)}`, { direction: 'top', className: 'mo-tip' })
            .addTo(map);
    });
    const gate = gateLatLng();
    L.marker(siteToLatLng(society.gate.x, site.depth / 2), {
        interactive: false,
        icon: L.divIcon({ className: 'mo-gate', html: '<span>Main gate</span>', iconSize: [80, 22], iconAnchor: [40, -6] }),
    }).addTo(map);
    // The neighbouring plotted colony, for orientation
    L.polygon(plotBoundary.points.map(plotToLatLng), { color: '#fbbc04', weight: 2, dashArray: '4 6', fill: false, interactive: false })
        .bindTooltip(`${esc(PLOT_SITE.name)} (plots)`, { permanent: true, direction: 'center', className: 'mo-area' })
        .addTo(map);

    // ─── Nearby places ───────────────────────────────
    const placeLayer = L.layerGroup().addTo(map);
    let route = null;
    const placeBounds = [];
    places.forEach(p => {
        const k = KINDS[p.kind] || KINDS.park;
        const info = placeFrom(p.pos);
        placeBounds.push(p.pos);
        L.marker(p.pos, {
            title: p.name,
            icon: L.divIcon({ className: 'mo-pin', html: `<span style="--c:${k.color}">${k.icon}</span>`, iconSize: [32, 32], iconAnchor: [16, 30] }),
        })
            .bindPopup(`<div class="mo-pop"><b>${esc(p.name)}</b>
                <span>${esc(k.label)} · ${p.driveMin != null ? `${p.driveMin} min drive` : ''} · ${info.km.toFixed(1)} km ${esc(info.dirName)}</span>
                <a href="${directionsBetween(gate, p.pos)}" target="_blank" rel="noopener">Directions from the society</a></div>`, { closeButton: false, className: 'mo-popup' })
            .on('popupopen', () => {
                route?.remove();
                route = L.polyline([gate, p.pos], { color: k.color, weight: 3, dashArray: '6 8', interactive: false }).addTo(map);
            })
            .on('popupclose', () => { route?.remove(); route = null; })
            .addTo(placeLayer);
    });

    // ─── Controls ────────────────────────────────────
    const compass = root.querySelector('.mo-compass');
    map.on('rotate', () => { compass.style.transform = `rotate(${-map.getBearing()}deg)`; });
    const fitSite = () => map.fitBounds(L.latLngBounds([...outline, gate]), { padding: [70, 70], maxZoom: 18.5 });
    root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mo]');
        if (!b) return;
        const act = b.dataset.mo;
        if (act === 'close') onClose?.();
        if (act === 'zoom-in') map.zoomIn();
        if (act === 'zoom-out') map.zoomOut();
        if (act === 'rotate-left') map.setBearing(map.getBearing() - 30);
        if (act === 'rotate-right') map.setBearing(map.getBearing() + 30);
        if (act === 'north') map.setBearing(0);
        if (act === 'fit-all') map.fitBounds(L.latLngBounds([...outline, ...placeBounds]), { padding: [60, 60] });
    });

    let fitted = false;
    return {
        show() {
            map.invalidateSize();
            if (!fitted) { fitSite(); fitted = true; }
        },
        focusPlace(p) {
            map.invalidateSize();
            map.flyToBounds(L.latLngBounds([gate, p.pos]), { padding: [80, 80], duration: 0.8 });
            placeLayer.eachLayer(m => { if (m.options.title === p.name) setTimeout(() => m.openPopup(), 850); });
        },
    };
}
