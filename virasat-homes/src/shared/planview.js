// 2D site plan (SVG) with pan / zoom, drawn from the digitised layout. Shared by the customer site and
// the admin panel. Colours come from the caller so each app can show what it needs.
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import 'd3-transition';
import { layout, centroid, bbox, NORTH_ON_PLAN } from './geo.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
};
const path = (pts) => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';

export const AMENITY_FILL = { park: '#cfe8c6', green: '#d7ecd0', play: '#d4f0e6', utility: '#ececec', commercial: '#dbe6f7', shops: '#efe3f3' };

export function createPlanView(container, { fillOf, strokeOf, onSelect, padding = () => ({ top: 16, right: 16, bottom: 16, left: 16 }) } = {}) {
    const B = bbox(layout.boundary);
    const M = 40;
    const svg = el('svg', { class: 'planview', viewBox: `${B.minX - M} ${B.minY - M} ${B.w + 2 * M} ${B.h + 2 * M}`, role: 'img', 'aria-label': 'Site plan of Virasat Homes' });
    container.appendChild(svg);
    const root = el('g', {}, svg);

    // site base = road surface; everything else is drawn on top
    el('path', { d: path(layout.boundary), class: 'pv-site' }, root);
    for (const a of layout.amenities) {
        el('path', { d: path(a.points), class: 'pv-amenity', fill: AMENITY_FILL[a.kind] || '#eee' }, root);
        const [cx, cy] = centroid(a.points);
        const b = bbox(a.points);
        const t = el('text', { x: cx, y: cy, class: 'pv-amenity-label', 'font-size': Math.max(9, Math.min(18, b.w / 8)) }, root);
        t.textContent = a.name;
        if (b.h > b.w * 2) t.setAttribute('transform', `rotate(-81 ${cx} ${cy})`);
    }
    for (const r of layout.roadLabels) {
        const t = el('text', { x: r.at[0], y: r.at[1], class: 'pv-road-label', transform: `rotate(${r.angle} ${r.at[0]} ${r.at[1]})` }, root);
        t.textContent = r.text.toUpperCase();
    }
    el('path', { d: path(layout.boundary), class: 'pv-boundary' }, root);

    const shapes = new Map();
    const plotLayer = el('g', { class: 'pv-plots' }, root);
    const labelLayer = el('g', { class: 'pv-labels' }, root);
    for (const p of layout.plots) {
        const s = el('path', { d: path(p.points), class: 'pv-plot', 'data-id': p.id }, plotLayer);
        const [cx, cy] = centroid(p.points);
        const b = bbox(p.points);
        const fs = Math.max(5, Math.min(12, Math.min(b.w, b.h) * 0.42));
        const t = el('text', { x: cx, y: cy, class: 'pv-label', 'font-size': fs }, labelLayer);
        t.textContent = p.id;
        shapes.set(p.id, { s, t, p, c: [cx, cy] });
    }

    // compass: true north relative to the drawing
    const comp = el('g', { class: 'pv-compass', transform: `translate(${B.maxX - 10} ${B.minY + 10}) rotate(${NORTH_ON_PLAN})` }, svg);
    el('circle', { r: 16, class: 'pv-compass-ring' }, comp);
    el('path', { d: 'M0,-13 L5,3 L0,0 L-5,3 Z', class: 'pv-compass-n' }, comp);
    const n = el('text', { y: -19, class: 'pv-compass-t' }, comp);
    n.textContent = 'N';

    plotLayer.addEventListener('click', (e) => {
        const id = e.target.closest('.pv-plot')?.dataset.id;
        if (id) { e.stopPropagation(); onSelect?.(id); }
    });
    svg.addEventListener('click', () => onSelect?.(null));

    let selected = null;
    function update() {
        for (const { s, p } of shapes.values()) {
            s.setAttribute('fill', fillOf ? fillOf(p) : '#9ccc65');
            s.setAttribute('stroke', strokeOf ? strokeOf(p) : '#fff');
            s.classList.toggle('is-selected', p.id === selected);
        }
        const sel = shapes.get(selected);
        if (sel) plotLayer.appendChild(sel.s);
    }

    // pan & zoom
    const z = zoom().scaleExtent([1, 14]).on('zoom', (ev) => {
        root.setAttribute('transform', ev.transform.toString());
        svg.classList.toggle('zoomed-in', ev.transform.k > 2.2);
        svg.classList.toggle('zoomed-far', ev.transform.k < 1.4);
    });
    const sel = select(svg).call(z).on('dblclick.zoom', null);

    function focus(id, k = 4) {
        const s = shapes.get(id);
        if (!s) return;
        const vb = svg.viewBox.baseVal;
        const pad = padding();
        // keep the plot clear of overlays (sheet / toolbars) by shifting the target point
        const rect = svg.getBoundingClientRect();
        const scale = Math.min(rect.width / vb.width, rect.height / vb.height) || 1;
        const dx = ((pad.left - pad.right) / 2) / scale;
        const dy = ((pad.top - pad.bottom) / 2) / scale;
        const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
        // root transform maps p → k·p + t, so this puts the plot centre at the middle of the free area
        const t = zoomIdentity.translate(cx + dx, cy + dy).scale(k).translate(-s.c[0], -s.c[1]);
        sel.transition().duration(500).call(z.transform, t);
    }
    const reset = () => sel.transition().duration(400).call(z.transform, zoomIdentity);
    const zoomBy = (f) => sel.transition().duration(250).call(z.scaleBy, f);

    return {
        svg,
        update,
        select(id) { selected = id; update(); },
        focus,
        reset,
        zoomIn: () => zoomBy(1.6),
        zoomOut: () => zoomBy(1 / 1.6),
    };
}
