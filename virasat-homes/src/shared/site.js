// Virasat Homes site data in the same shape the site-plan views expect (plan, 3D, map, sheet, walk).
// Source: data/layout.json (digitised from the developer brochure). Plan units are feet, y down.
import layout from '../../data/layout.json';
import { toLatLng as planToLatLng, centroid, bbox, polygonArea } from './geo.js';
import { tokenFromPlan } from './status.js';

export const SITE = {
    name: 'Virasat Homes',
    tagline: 'Plots · Chaksu, Jaipur',
    phone: (import.meta.env.VITE_VIRASAT_PHONE || '').replace(/\D/g, ''),
    whatsapp: (import.meta.env.VITE_VIRASAT_WHATSAPP || import.meta.env.VITE_VIRASAT_PHONE || '').replace(/\D/g, ''),
    rera: layout.project.rera,
};
export const PROJECT = layout.project;

// ─── GEOGRAPHIC ANCHOR ───────────────────────────────
// Same convention as the main site: lat/lng = plan point (centerX, centerY), rotationDeg turns the plan
// counter-clockwise from north. toLatLng below is the exact fitted transform from layout.json.
const B = bbox(layout.boundary);
const centerX = (B.minX + B.maxX) / 2;
const centerY = (B.minY + B.maxY) / 2;
const [cLat, cLng] = planToLatLng([centerX, centerY]);
export const GEO = {
    lat: cLat,
    lng: cLng,
    rotationDeg: layout.geo.rotationDeg,
    metersPerUnit: layout.geo.mPerFt,
    centerX,
    centerY,
    gate: layout.gate.point,
    gateDir: layout.gate.dir,
};
export const toLatLng = planToLatLng;

// No zones on this layout (filters hide the zone row when the list is empty)
export const ZONES = [];
export { STATUS_COLORS } from './status.js';

// ─── HELPERS ─────────────────────────────────────────
const R = (layout.geo.rotationDeg * Math.PI) / 180;
// plan direction (x right, y down) → compass bearing in degrees
function bearingOf([nx, ny]) {
    const X = nx, Y = -ny;
    const E = X * Math.cos(R) - Y * Math.sin(R);
    const N = X * Math.sin(R) + Y * Math.cos(R);
    return ((Math.atan2(E, N) * 180) / Math.PI + 360) % 360;
}
const CARD = ['North', 'East', 'South', 'West'];
const dir4 = (b) => CARD[Math.round(b / 90) % 4];
const BEARING_OF = { North: 0, 'North-East': 45, East: 90, 'South-East': 135, South: 180, 'South-West': 225, West: 270, 'North-West': 315 };

// Size along plan-x (w) and plan-y (h). Uses the printed size for standard plots; otherwise the
// drawn shape measured along the block grid, scaled so w × h equals the stated area.
function dimensions(p) {
    const pts = p.points;
    let best = 0, ang = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    }
    // fold the grid angle into (-45°, 45°] so u is the near-horizontal axis
    ang = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (ang > Math.PI / 4) ang -= Math.PI / 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of pts) {
        const u = x * c + y * s, v = -x * s + y * c;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    let w = u1 - u0, h = v1 - v0;
    if (p.dims && p.areaSource === 'plan' && !p.dims.label.startsWith('≈')) {
        // printed size: narrow side goes on the shorter measured axis
        const [a, b2] = [Math.min(p.dims.w, p.dims.d), Math.max(p.dims.w, p.dims.d)];
        return w <= h ? { w: +a.toFixed(1), h: +b2.toFixed(1), exact: true } : { w: +b2.toFixed(1), h: +a.toFixed(1), exact: true };
    }
    const k = Math.sqrt((p.areaSqYd * 9) / (w * h));
    if (Number.isFinite(k) && k > 0.7 && k < 1.3) { w *= k; h *= k; }
    return { w: +w.toFixed(1), h: +h.toFixed(1), exact: false };
}

// ─── FEATURES ────────────────────────────────────────
function roadPolygon(r) {
    const [ax, ay] = r.a, [bx, by] = r.b;
    const L = Math.hypot(bx - ax, by - ay);
    const dx = (bx - ax) / L, dy = (by - ay) / L;
    const nx = -dy * (r.widthFt / 2), ny = dx * (r.widthFt / 2);
    return [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
}

const feat = (kind, id, points, extra = {}) => ({ key: `${kind}-${id}-${extra.i ?? ''}`, id, kind, points, box: bbox(points), center: centroid(points), ...extra });

export const boundary = feat('boundary', 'SITE BOUNDARY', layout.boundary);

const roadFeatures = layout.roads.map((r, i) => feat('road', r.id, roadPolygon(r), {
    i, axis: { a: r.a, b: r.b, width: r.widthFt, angle: (Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0]) * 180) / Math.PI },
}));

const commons = layout.amenities.map((a, i) => feat('common', a.name, a.points, { i, amenity: a.kind, area: `${a.areaSqYd} sq yd` }));

export const plots = layout.plots.map((p, i) => {
    const f = feat('plot', p.id, p.points, { i });
    const dims = dimensions(p);
    const facing = [];
    for (const s of p.facing) {
        const dir = dir4(bearingOf(roadNormal(s)));
        if (!facing.some(x => x.dir === dir)) facing.push({ dir, road: `${s.roadFt} ft road`, roadFt: s.roadFt });
    }
    return Object.assign(f, {
        status: 'Available',
        price: '-',
        priceLakh: 0,
        pricePerSqYd: null,
        areaSqYd: p.areaSqYd,
        areaSqFt: p.areaSqFt,
        area: `${p.areaSqYd} sq yd`,
        areaSource: p.areaSource,
        gaj: p.areaSqYd,
        category: p.category,
        dims,
        facing,
        zone: null,
    });
});

// layout.json facing carries a compass bearing; turn it back into a plan direction for dir4()
function roadNormal(s) {
    const b = ((s.bearing ?? BEARING_OF[s.dir] ?? 180) * Math.PI) / 180;
    const E = Math.sin(b), N = Math.cos(b);
    // invert the plan rotation: plan X/Y from E/N
    const X = E * Math.cos(R) + N * Math.sin(R);
    const Y = -E * Math.sin(R) + N * Math.cos(R);
    return [X, -Y];
}

const ORDER = { boundary: 0, common: 1, road: 2, plot: 3 };
export const features = [boundary, ...commons, ...roadFeatures, ...plots].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
export const roads = roadFeatures;
export const roadLabels = layout.roadLabels;

export const plotById = new Map(plots.map(p => [p.id, p]));

export const stats = {
    total: plots.length,
    available: plots.length,
    sold: 0,
};

export const formatPrice = (p) => (p.price && p.price !== '-' ? p.price : 'On request');

// Normalise any plan status token (kept for parity with the main site's helpers)
export const normaliseStatus = tokenFromPlan;
export const siteAreaAcres = polygonArea(layout.boundary) / 43560;
