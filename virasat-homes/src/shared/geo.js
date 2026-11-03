// Plan geometry and placement on Earth for Virasat Homes. Plan units are feet (x right, y down),
// digitised from the brochure layout; data/layout.json "geo" holds the fitted placement.
import layout from '../../data/layout.json' with { type: 'json' };

const G = layout.geo;
const R = (G.rotationDeg * Math.PI) / 180;
const COS = Math.cos(R);
const SIN = Math.sin(R);

// Plan [x, y] in feet → [lat, lng]
export function toLatLng([x, y]) {
    const X = (x - G.origin[0]) * G.mPerFt;
    const Y = (G.origin[1] - y) * G.mPerFt;
    const E = X * COS - Y * SIN + G.e0;
    const N = X * SIN + Y * COS + G.n0;
    return [G.lat0 + N / G.mPerDegLat, G.lng0 + E / G.mPerDegLng];
}

// True north as seen on the plan drawing, in degrees clockwise from "up" (for compass needles)
export const NORTH_ON_PLAN = G.rotationDeg; // plan is turned clockwise by -rotationDeg, so north leans the other way

// Shoelace area (plan units²)
export function polygonArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return Math.abs(a / 2);
}

// Area-weighted centre
export function centroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
        a += f;
        cx += (pts[j][0] + pts[i][0]) * f;
        cy += (pts[j][1] + pts[i][1]) * f;
    }
    if (!a) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPolygon([x, y], pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

export function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Direction of the longest edge (degrees, screen space with y down) — used to turn plot labels
export function longEdgeAngle(pts) {
    let best = 0, ang = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > best) { best = l; ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; }
    }
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    return ang;
}

export { layout };
