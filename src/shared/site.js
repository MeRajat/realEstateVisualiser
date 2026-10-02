// Site configuration + derived plot data shared by the customer & builder apps.
import rawPlots from './plots_data.json';
import geo from './geo.json';

export const SITE = {
    name: 'The Greater Mansarovar',
    tagline: 'Residential Plots · Jaipur',
    // Builder contact shown on the customer app. Leave empty to hide the buttons.
    phone: import.meta.env.VITE_BUILDER_PHONE || '',
    whatsapp: import.meta.env.VITE_BUILDER_WHATSAPP || '',
};

// ─── GEOGRAPHIC ANCHOR ───────────────────────────────
// Plan placement on Earth lives in geo.json (shared with scripts/fetch-nearby.mjs).
export const GEO = geo;
const M_LAT = 110850;
const M_LNG = 111320 * Math.cos((GEO.lat * Math.PI) / 180);
const ROT = (GEO.rotationDeg * Math.PI) / 180;

// Plan [x, y] (feet, y down) → [lat, lng]
export function toLatLng([x, y]) {
    const dx = (x - GEO.centerX) * GEO.metersPerUnit;  // metres along plan-east
    const dy = (GEO.centerY - y) * GEO.metersPerUnit;  // metres along plan-north
    const e = dx * Math.cos(ROT) - dy * Math.sin(ROT);
    const n = dx * Math.sin(ROT) + dy * Math.cos(ROT);
    return [GEO.lat + n / M_LAT, GEO.lng + e / M_LNG];
}

// ─── ZONES (2×2 quadrant grid split by the main roads) ─
export const ZONES = [
    { id: 'A', name: 'Zone A', color: '#4285f4', x1: 50, y1: 292, x2: 415, y2: 610 },
    { id: 'B', name: 'Zone B', color: '#ea4335', x1: 427, y1: 292, x2: 630, y2: 610 },
    { id: 'C', name: 'Zone C', color: '#fbbc04', x1: 50, y1: 622, x2: 415, y2: 910 },
    { id: 'D', name: 'Zone D', color: '#34a853', x1: 427, y1: 622, x2: 630, y2: 910 },
];

export const STATUS_COLORS = {
    Available: '#34a853',
    Sold: '#9aa0a6',
    Reserved: '#fbbc04',
};

// ─── GEOMETRY HELPERS ────────────────────────────────
function bbox(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function centroid(points) {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

const parseNumber = (s) => parseFloat(String(s).replace(/[^\d.]/g, '')) || 0;

// 1 data unit = 1 ft. Pick the long side from the bbox and derive the other from
// the stated area so that length × breadth always equals the advertised area.
function dimensions(box, areaSqFt) {
    if (!areaSqFt) return null;
    if (box.h > box.w) {
        const h = Math.round(box.h * 10) / 10;
        return { w: +(areaSqFt / h).toFixed(2), h };
    }
    const w = Math.round(box.w * 10) / 10;
    return { w, h: +(areaSqFt / w).toFixed(2) };
}

function facingFor(plot, roads) {
    const b = plot.box;
    const TOL = 5;
    const out = [];
    const add = (dir, road) => { if (!out.some(f => f.dir === dir)) out.push({ dir, road }); };
    for (const r of roads) {
        const rb = r.box;
        const horizontal = rb.w > rb.h;
        if (horizontal) {
            const overlapX = rb.minX < b.maxX && rb.maxX > b.minX;
            if (overlapX && Math.abs(rb.maxY - b.minY) <= TOL) add('North', r.id);
            if (overlapX && Math.abs(rb.minY - b.maxY) <= TOL) add('South', r.id);
        } else {
            const overlapY = rb.minY < b.maxY && rb.maxY > b.minY;
            if (overlapY && Math.abs(rb.maxX - b.minX) <= TOL) add('West', r.id);
            if (overlapY && Math.abs(rb.minX - b.maxX) <= TOL) add('East', r.id);
        }
    }
    return out;
}

function zoneFor(box) {
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    return ZONES.find(z => cx >= z.x1 && cx <= z.x2 && cy >= z.y1 && cy <= z.y2)?.id || null;
}

// ─── BUILD NORMALISED FEATURE LIST ───────────────────
function kindOf(d) {
    if (d.id === 'SITE BOUNDARY') return 'boundary';
    if (d.isRoad) return 'road';
    if (d.isPark) return 'common';
    return 'plot';
}

const ORDER = { boundary: 0, common: 1, road: 2, plot: 3 };

export const features = rawPlots
    .map((d, i) => {
        const kind = kindOf(d);
        const box = bbox(d.points);
        return {
            key: `${kind}-${i}`, // road ids repeat, so keep a unique key
            id: d.id,
            kind,
            status: d.status,
            price: d.price,
            area: d.area,
            areaSqFt: parseNumber(d.area),
            priceLakh: parseNumber(d.price),
            points: d.points,
            box,
            center: centroid(d.points),
        };
    })
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);

const roads = features.filter(f => f.kind === 'road');

export const plots = features.filter(f => f.kind === 'plot');

// The source plan reuses some plot numbers (e.g. two plots labelled "180"). Keep ids unique
// so selection, share links and leads point at one plot; fix the numbers in plots_data.json.
const seenIds = new Map();
plots.forEach(p => {
    const n = (seenIds.get(p.id) || 0) + 1;
    seenIds.set(p.id, n);
    if (n > 1) {
        console.warn(`[site] Duplicate plot number "${p.id}" in plots_data.json — showing it as "${p.id}-${n}"`);
        p.id = `${p.id}-${n}`;
    }
});

plots.forEach(p => {
    p.dims = dimensions(p.box, p.areaSqFt);
    p.gaj = Math.round((p.areaSqFt / 9) * 10) / 10;
    p.facing = facingFor(p, roads);
    p.zone = zoneFor(p.box);
});

// Zone label anchor: the point nearest the zone centre where a label box
// (≈ "ZONE A" at the zoomed-out map scale) doesn't touch any road.
const LABEL_HALF_W = 48;
const LABEL_HALF_H = 10;
ZONES.forEach(z => {
    const cx = (z.x1 + z.x2) / 2;
    const cy = (z.y1 + z.y2) / 2;
    const clear = (x, y) => roads.every(r =>
        x + LABEL_HALF_W < r.box.minX || x - LABEL_HALF_W > r.box.maxX ||
        y + LABEL_HALF_H < r.box.minY || y - LABEL_HALF_H > r.box.maxY);
    let best = [cx, cy];
    let bestD = Infinity;
    for (let x = z.x1 + LABEL_HALF_W; x <= z.x2 - LABEL_HALF_W; x += 4) {
        for (let y = z.y1 + LABEL_HALF_H; y <= z.y2 - LABEL_HALF_H; y += 4) {
            const d = (x - cx) ** 2 + (y - cy) ** 2;
            if (d < bestD && clear(x, y)) { best = [x, y]; bestD = d; }
        }
    }
    z.labelAt = best;
});

export const plotById = new Map(plots.map(p => [p.id, p]));
export const boundary = features.find(f => f.kind === 'boundary');

export const stats = {
    total: plots.length,
    available: plots.filter(p => p.status === 'Available').length,
    sold: plots.filter(p => p.status === 'Sold').length,
};

export const formatPrice = (p) => (p.price && p.price !== '-' ? p.price : 'On request');
