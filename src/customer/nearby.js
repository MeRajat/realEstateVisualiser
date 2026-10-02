// "Nearby" layer for the satellite map: real places around the site (OpenStreetMap),
// drive distance/time and routes (OSRM) from src/shared/nearby.json, plus the approach road.
import L from 'leaflet';
import nearby from '../shared/nearby.json';
import { getInsets } from './layout.js';

const path = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${d}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
export const KINDS = {
    hospital: { color: '#ea4335', label: 'Hospital', icon: path(`<path d="M12 5v14M5 12h14" ${S}/>`) },
    school: { color: '#f9ab00', label: 'School', icon: path(`<path d="m2 9 10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5" ${S}/>`) },
    college: { color: '#a142f4', label: 'College', icon: path(`<path d="M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z" ${S}/>`) },
    mall: { color: '#e52592', label: 'Shopping', icon: path(`<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" ${S}/>`) },
    park: { color: '#34a853', label: 'Park', icon: path(`<path d="M12 3 6 13h12zM12 13v8" ${S}/>`) },
    airport: { color: '#4285f4', label: 'Airport', icon: path(`<path d="M10 20l2-6-7-3 1-2 8 1 4-6 2 1-2 7 4 2-1 2-5-1-3 6z" ${S}/>`) },
    railway: { color: '#4285f4', label: 'Railway', icon: path(`<rect x="6" y="3" width="12" height="13" rx="3" ${S}/><path d="M6 11h12M9 20l-2 2M15 20l2 2" ${S}/>`) },
    bus: { color: '#4285f4', label: 'Bus', icon: path(`<rect x="5" y="4" width="14" height="13" rx="2" ${S}/><path d="M5 11h14M8 20v-3M16 20v-3" ${S}/>`) },
};
const ROAD_ICON = path(`<path d="M8 3 5 21M16 3l3 18M12 4v3M12 11v3M12 18v2" ${S}/>`);

const esc = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`);

export function createNearbyLayer(map, { siteLatLngs, onOpen }) {
    const panel = document.getElementById('nearby-panel');
    const list = panel.querySelector('.nearby-list');
    const cats = panel.querySelector('.nearby-cats');
    const entrance = nearby.approach.path[1];

    // ─── Approach road + entrance ────────────────────
    L.polyline(nearby.approach.path, { color: '#3b413d', weight: 10, opacity: 0.95, lineCap: 'butt', interactive: false }).addTo(map);
    L.polyline(nearby.approach.path, { color: '#ffffff', weight: 1, opacity: 0.6, dashArray: '4 6', interactive: false }).addTo(map);
    L.marker(nearby.gate, {
        interactive: false,
        icon: L.divIcon({ className: 'map-gate', html: '<span>Entrance</span>', iconSize: [70, 22], iconAnchor: [-6, 11] }),
    }).addTo(map);

    // ─── Place markers ───────────────────────────────
    const markers = new Map();
    nearby.places.forEach((p, i) => {
        const k = KINDS[p.kind] || KINDS.park;
        const m = L.marker(p.pos, {
            title: p.name,
            icon: L.divIcon({ className: 'poi-marker', html: `<span style="--c:${k.color}">${k.icon}</span>`, iconSize: [30, 30] }),
            keyboard: true,
        }).addTo(map);
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); focus(i); open(); });
        markers.set(i, m);
    });

    // ─── Routes ──────────────────────────────────────
    let routeLayer = null;
    let active = -1;
    let cat = 'all';

    function padding() {
        const i = getInsets({ withSheet: true });
        return { paddingTopLeft: [i.left + 10, i.top + 10], paddingBottomRight: [i.right + 10, i.bottom + 10] };
    }

    function focus(i) {
        active = i;
        const p = nearby.places[i];
        const k = KINDS[p.kind] || KINDS.park;
        routeLayer?.remove();
        const line = p.route || [entrance, p.pos];
        routeLayer = L.layerGroup([
            L.polyline(line, { color: '#0b0f0d', weight: 8, opacity: 0.55, interactive: false }),
            L.polyline(line, { color: k.color, weight: 4, dashArray: p.route ? null : '6 8', interactive: false }),
        ]).addTo(map);
        markers.forEach((m, j) => m.getElement()?.classList.toggle('is-active', j === i));
        render();
        requestAnimationFrame(() => map.flyToBounds(L.latLngBounds([...line, ...siteLatLngs]), { ...padding(), maxZoom: 17, duration: 0.8 }));
    }

    function clearRoute() {
        routeLayer?.remove();
        routeLayer = null;
        active = -1;
        markers.forEach(m => m.getElement()?.classList.remove('is-active'));
    }

    // ─── Panel ───────────────────────────────────────
    const CHIPS = [{ id: 'all', label: 'All' }, ...nearby.categories, { id: 'roads', label: 'Roads' }];

    function render() {
        cats.innerHTML = CHIPS.map(c => `<button type="button" class="pill${c.id === cat ? ' is-active' : ''}" data-cat="${c.id}" aria-pressed="${c.id === cat}">${esc(c.label)}</button>`).join('');
        // quickest drive in each headline category
        const quickest = (test) => nearby.places.filter(test).sort((a, b) => a.driveMin - b.driveMin)[0];
        const highlights = [
            quickest(p => p.kind === 'airport'),
            quickest(p => p.kind === 'hospital'),
            quickest(p => p.cat === 'school'),
            quickest(p => p.kind === 'mall'),
        ].filter(Boolean);

        let html = '';
        if (cat === 'all') {
            html += `<div class="nearby-highlights">${highlights.map(p => {
                const k = KINDS[p.kind];
                return `<button type="button" data-i="${nearby.places.indexOf(p)}" style="--c:${k.color}">
                    <span class="poi-ic">${k.icon}</span><b>${p.driveMin} min</b><small>${k.label}</small></button>`;
            }).join('')}</div>
            <p class="nearby-entry">${ROAD_ICON}<span>Main entrance on <b>${esc(nearby.approach.road)}</b> (4-lane), via a ${nearby.approach.lengthM} m approach road</span></p>`;
        }
        if (cat === 'roads') {
            html += nearby.roads.map(r => `<div class="nearby-item is-static">
                <span class="poi-ic" style="--c:#5f6368">${ROAD_ICON}</span>
                <span class="ni-text"><b>${esc(r.name)}</b><small>${r.type === 'secondary' ? 'Arterial road' : 'Highway / main road'}</small></span>
                <span class="ni-dist"><b>${fmtKm(r.km)}</b><small>away</small></span></div>`).join('');
        } else {
            html += nearby.places.map((p, i) => ({ p, i }))
                .filter(({ p }) => cat === 'all' || p.cat === cat)
                .map(({ p, i }) => {
                    const k = KINDS[p.kind] || KINDS.park;
                    return `<button type="button" class="nearby-item${i === active ? ' is-active' : ''}" data-i="${i}">
                        <span class="poi-ic" style="--c:${k.color}">${k.icon}</span>
                        <span class="ni-text"><b>${esc(p.name)}</b><small>${k.label}</small></span>
                        <span class="ni-dist"><b>${p.driveMin} min</b><small>${fmtKm(p.driveKm)} drive</small></span>
                    </button>`;
                }).join('');
        }
        list.innerHTML = html;
    }

    panel.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-cat]');
        if (chip) { cat = chip.dataset.cat; render(); list.scrollTop = 0; return; }
        const item = e.target.closest('[data-i]');
        if (item) focus(Number(item.dataset.i));
        if (e.target.closest('.nearby-close')) close();
    });

    function open() {
        if (!panel.hidden && panel.classList.contains('is-open')) return;
        onOpen?.();
        render();
        panel.hidden = false;
        requestAnimationFrame(() => panel.classList.add('is-open'));
    }
    function close() {
        panel.classList.remove('is-open');
        clearRoute();
        setTimeout(() => { if (!panel.classList.contains('is-open')) panel.hidden = true; }, 260);
    }

    return { open, close, isOpen: () => panel.classList.contains('is-open') };
}
