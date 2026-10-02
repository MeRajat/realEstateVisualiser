// Satellite map with the site plan overlaid (Leaflet). Lazy-loaded on first open.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { features, boundary, toLatLng, ZONES, STATUS_COLORS } from '../shared/site.js';
import { state, on, selectPlot, matchesFilter } from './store.js';
import { getInsets } from './layout.js';
import { createNearbyLayer } from './nearby.js';

const MAP_COLORS = { road: '#2b302d', common: '#3d7a3c', selected: '#2dd4bf', dim: '#1d2420' };

export function createMapView(el, { opacitySlider } = {}) {
    const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.25, maxZoom: 20 });
    map.attributionControl.setPrefix(false);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20,
        maxNativeZoom: 18, // Esri has no z19 imagery for this area — upscale z18 instead
        attribution: 'Imagery © Esri',
    }).addTo(map);

    const ll = (points) => points.map(toLatLng);
    const layers = new Map(); // plot id → polygon
    const areaLayers = []; // roads + green areas

    L.polygon(ll(boundary.points), {
        color: '#d9cfb6', weight: 2.5, dashArray: '8 5', fill: false, interactive: false,
    }).addTo(map);

    features.filter(f => f.kind === 'road' || f.kind === 'common').forEach(f => {
        const poly = L.polygon(ll(f.points), {
            stroke: false,
            fillColor: MAP_COLORS[f.kind],
            fillOpacity: 0.6,
            interactive: false,
        }).addTo(map);
        areaLayers.push(poly);
        if (f.kind === 'road') {
            poly.bindTooltip(f.id, { permanent: true, direction: 'center', className: 'map-road-label' });
        }
    });

    features.filter(f => f.kind === 'plot').forEach(p => {
        const poly = L.polygon(ll(p.points), { weight: 1, color: 'rgba(255,255,255,0.45)', fillOpacity: 0.6 }).addTo(map);
        poly.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectPlot(p.id, 'map');
        });
        if (window.matchMedia('(hover: hover)').matches) {
            poly.bindTooltip(`<b>Plot ${p.id}</b> · ${p.area}`, { sticky: true, direction: 'top', className: 'map-tip' });
        }
        layers.set(p.id, { poly, plot: p });
    });

    ZONES.forEach(z => {
        L.marker(toLatLng(z.labelAt), {
            interactive: false,
            icon: L.divIcon({ className: 'map-zone-label', html: `<span style="color:${z.color}">${z.name}</span>`, iconSize: [80, 20] }),
        }).addTo(map);
    });

    const nearby = createNearbyLayer(map, {
        siteLatLngs: ll(boundary.points),
        onOpen: () => { if (state.selectedId) selectPlot(null, 'map'); },
    });

    map.on('click', () => { if (state.selectedId) selectPlot(null, 'map'); });
    const syncLabels = () => {
        el.classList.toggle('show-road-labels', map.getZoom() >= 18.5);
        el.classList.toggle('hide-zone-labels', map.getZoom() < 16.5);
    };
    map.on('zoomend', syncLabels);

    let opacity = opacitySlider ? opacitySlider.value / 100 : 0.65;

    function style() {
        layers.forEach(({ poly, plot }) => {
            const selected = plot.id === state.selectedId;
            const match = matchesFilter(plot);
            poly.setStyle({
                fillColor: selected ? MAP_COLORS.selected : match ? STATUS_COLORS[plot.status] : MAP_COLORS.dim,
                fillOpacity: selected ? Math.max(0.75, opacity) : match ? opacity : opacity * 0.4,
                color: selected ? '#ffffff' : 'rgba(255,255,255,0.45)',
                weight: selected ? 3 : 1,
            });
            if (selected) poly.bringToFront();
        });
        areaLayers.forEach(l => l.setStyle({ fillOpacity: opacity * 0.9 }));
    }

    function padding() {
        const i = getInsets({ withSheet: true });
        return { paddingTopLeft: [i.left, i.top], paddingBottomRight: [i.right, i.bottom] };
    }

    function reset() {
        map.fitBounds(ll(boundary.points), { ...padding(), animate: true });
    }

    function focus(plot) {
        map.flyToBounds(layers.get(plot.id).poly.getBounds(), { ...padding(), maxZoom: 19.5, duration: 0.7 });
    }

    opacitySlider?.addEventListener('input', () => {
        opacity = opacitySlider.value / 100;
        style();
    });

    on('select', ({ plot, source }) => {
        style();
        if (plot && nearby.isOpen()) nearby.close();
        if (plot && source !== 'map' && state.view === 'map') requestAnimationFrame(() => focus(plot));
    });
    on('filter', style);
    style();

    let fitted = false;
    return {
        show() {
            map.invalidateSize();
            const sel = state.selectedId && layers.get(state.selectedId);
            if (sel) focus(sel.plot);
            else if (!fitted) map.fitBounds(ll(boundary.points), padding());
            fitted = true;
            syncLabels();
        },
        openNearby: () => nearby.open(),
        hide: () => nearby.close(),
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        reset,
    };
}
