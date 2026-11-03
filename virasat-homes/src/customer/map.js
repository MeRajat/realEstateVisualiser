// Satellite map with every plot drawn in its real place (Leaflet + Esri World Imagery).
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { layout, toLatLng, centroid, bbox } from '../shared/geo.js';
import { AMENITY_FILL } from '../shared/planview.js';

const ll = (pts) => pts.map(toLatLng);
// a direction drawn on the plan shows on a north-up map turned by the plan's rotation
const mapAngle = (planAngle) => planAngle - layout.geo.rotationDeg;
// Main entrance on Kotkhawada Road (median tip of the two 40 ft roads, plan feet)
const ENTRANCE = [755.6, 1308];

export function createMap(el, { fillOf, onSelect, padding }) {
    const map = L.map(el, { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, maxZoom: 21, minZoom: 12, attributionControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 21, maxNativeZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 21, maxNativeZoom: 18, opacity: 0.85,
    }).addTo(map);

    const site = L.polygon(ll(layout.boundary), { color: '#ffffff', weight: 2.5, dashArray: '7 5', fillColor: '#5f6368', fillOpacity: 0.55, interactive: false }).addTo(map);
    const areas = layout.amenities.map(a => {
        const poly = L.polygon(ll(a.points), { stroke: false, fillColor: AMENITY_FILL[a.kind], fillOpacity: 0.7, interactive: false }).addTo(map);
        const b = bbox(a.points);
        L.marker(toLatLng(centroid(a.points)), {
            interactive: false,
            icon: L.divIcon({ className: 'm-amenity', html: `<span style="transform:rotate(${b.h > b.w * 2 ? mapAngle(-81) : 0}deg)">${a.name}</span>`, iconSize: [0, 0] }),
        }).addTo(map);
        return poly;
    });
    for (const r of layout.roadLabels) {
        L.marker(toLatLng(r.at), {
            interactive: false,
            icon: L.divIcon({ className: 'm-road', html: `<span style="transform:rotate(${mapAngle(r.angle)}deg)">${r.text}</span>`, iconSize: [0, 0] }),
        }).addTo(map);
    }

    const shapes = new Map();
    for (const p of layout.plots) {
        const poly = L.polygon(ll(p.points), { weight: 1, color: 'rgba(255,255,255,.75)', fillOpacity: 0.7 }).addTo(map);
        poly.on('click', (e) => { L.DomEvent.stopPropagation(e); onSelect(p.id); });
        const b = bbox(p.points);
        const small = Math.min(b.w, b.h) < 22;
        L.marker(toLatLng(centroid(p.points)), {
            interactive: false,
            icon: L.divIcon({ className: 'm-plot' + (small ? ' m-plot-sm' : ''), html: `<span>${p.id}</span>`, iconSize: [0, 0] }),
        }).addTo(map);
        shapes.set(p.id, { poly, p });
    }

    L.marker(toLatLng(ENTRANCE), {
        icon: L.divIcon({ className: 'm-gate', html: '<span>Main entrance · Kotkhawada Rd</span>', iconSize: [0, 0] }),
        interactive: false,
    }).addTo(map);

    map.on('click', () => onSelect(null));
    const syncZoomClasses = () => {
        const z = map.getZoom();
        el.classList.toggle('z-labels', z >= 18.75);
        el.classList.toggle('z-labels-sm', z >= 19.75);
        el.classList.toggle('z-roads', z >= 17.75);
    };
    map.on('zoomend', syncZoomClasses);

    let opacity = 0.7;
    let selected = null;
    function update() {
        for (const { poly, p } of shapes.values()) {
            const isSel = p.id === selected;
            const f = fillOf(p);
            poly.setStyle({
                fillColor: isSel ? '#1a73e8' : f.color,
                fillOpacity: isSel ? Math.max(0.85, opacity) : f.dim ? opacity * 0.35 : opacity,
                color: isSel ? '#ffffff' : 'rgba(255,255,255,.75)',
                weight: isSel ? 3 : 1,
            });
            if (isSel) poly.bringToFront();
        }
        site.setStyle({ fillOpacity: opacity * 0.75 });
        areas.forEach(a => a.setStyle({ fillOpacity: opacity }));
    }

    const pad = () => {
        const p = padding();
        return { paddingTopLeft: [p.left, p.top], paddingBottomRight: [p.right, p.bottom] };
    };
    let fitted = false;
    const fit = (animate = true) => map.fitBounds(site.getBounds(), { ...pad(), animate });

    let me = null;
    return {
        map,
        update,
        select(id) { selected = id; update(); },
        focus(id) {
            const s = shapes.get(id);
            if (s) map.flyToBounds(s.poly.getBounds(), { ...pad(), maxZoom: 20, duration: 0.6 });
        },
        setOpacity(v) { opacity = v; update(); },
        show() {
            map.invalidateSize();
            if (!fitted) { fit(false); fitted = true; }
            syncZoomClasses();
        },
        fit,
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        locate() {
            return new Promise((resolve, reject) => {
                map.once('locationfound', (e) => {
                    if (me) me.remove();
                    me = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
                    const d = e.latlng.distanceTo(site.getBounds().getCenter());
                    map.fitBounds(L.latLngBounds([e.latlng, ...site.getLatLngs()[0]]), pad());
                    resolve(d);
                });
                map.once('locationerror', reject);
                map.locate({ enableHighAccuracy: true, timeout: 10000 });
            });
        },
    };
}
