#!/usr/bin/env node
// Builds src/shared/nearby.json: real places around the site (OpenStreetMap / Overpass),
// drive distance + time from the site gate (OSRM), routes to key places, and the approach road
// to the main road. Run after moving the site:  node scripts/fetch-nearby.mjs
// Data © OpenStreetMap contributors (ODbL).
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const GEO = JSON.parse(readFileSync(new URL('src/shared/geo.json', ROOT), 'utf8'));
const PLAN = JSON.parse(readFileSync(new URL('src/shared/plots_data.json', ROOT), 'utf8'));
const UA = { 'User-Agent': 'realEstateVisualiser/1.0 (site plan demo)', Accept: 'application/json' };

// ─── plan → lat/lng (must match src/shared/site.js) ─────
const M_LAT = 110850;
const M_LNG = 111320 * Math.cos((GEO.lat * Math.PI) / 180);
const rot = (GEO.rotationDeg * Math.PI) / 180;
function toLatLng([x, y]) {
    const dx = (x - GEO.centerX) * GEO.metersPerUnit;
    const dy = (GEO.centerY - y) * GEO.metersPerUnit;
    const e = dx * Math.cos(rot) - dy * Math.sin(rot);
    const n = dx * Math.sin(rot) + dy * Math.cos(rot);
    return [GEO.lat + n / M_LAT, GEO.lng + e / M_LNG];
}
const local = ([lat, lng]) => [(lng - GEO.lng) * M_LNG, (lat - GEO.lat) * M_LAT]; // metres E, N
const fromLocal = ([e, n]) => [GEO.lat + n / M_LAT, GEO.lng + e / M_LNG];
const haversine = (a, b) => {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

async function overpass(query, tries = 6) {
    for (let i = 0; i < tries; i++) {
        const res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
        }).catch(() => null);
        const text = res ? await res.text() : '';
        if (text.startsWith('{')) return JSON.parse(text).elements;
        await new Promise(r => setTimeout(r, 8000 * (i + 1)));
    }
    throw new Error('Overpass unavailable');
}

// ─── gate + approach road ────────────────────────────
// The east-west 9 MT road meets the east boundary; extend it (plan-east) to the main road.
const gatePlan = GEO.gate;
const gate = toLatLng(gatePlan);
const eastDir = [Math.cos(rot), Math.sin(rot)]; // plan +x in local metres (E, N)

console.log('Fetching roads…');
const roadEls = await overpass(`[out:json][timeout:90];way(around:400,${gate[0]},${gate[1]})["highway"~"^(trunk|primary|secondary|tertiary)$"];out geom;`);
let approach = null;
for (const w of roadEls) {
    const g = w.geometry.map(p => local([p.lat, p.lon]));
    const o = local(gate);
    for (let i = 0; i < g.length - 1; i++) {
        // ray o + t*eastDir vs segment g[i]→g[i+1]
        const [ax, ay] = g[i], [bx, by] = g[i + 1];
        const sx = bx - ax, sy = by - ay;
        const den = eastDir[0] * sy - eastDir[1] * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - o[0]) * sy - (ay - o[1]) * sx) / den;
        const u = ((ax - o[0]) * eastDir[1] - (ay - o[1]) * eastDir[0]) / den;
        if (t > 0 && u >= 0 && u <= 1 && (!approach || t < approach.lengthM)) {
            approach = { road: w.tags.name || w.tags.ref || 'Main road', lengthM: Math.round(t), end: fromLocal([o[0] + eastDir[0] * t, o[1] + eastDir[1] * t]) };
        }
    }
}
if (!approach) throw new Error('No main road found east of the gate');
console.log(`Approach road: ${approach.lengthM} m to ${approach.road}`);
const origin = approach.end;

// ─── points of interest ──────────────────────────────
const CATS = [
    { id: 'hospital', label: 'Hospitals', q: 'nwr["amenity"="hospital"]["name"]', r: 10000, n: 7,
      // nearest few + the city's major multi-speciality hospitals within reach
      notable: /fortis|narayana|mahatma gandhi|eternal|apex|bhandari|rukmani|manipal|sms/i, nearest: 3 },
    { id: 'school', label: 'Schools', q: 'nwr["amenity"="school"]["name"]', r: 4000, n: 6 },
    { id: 'college', label: 'Colleges', q: 'nwr["amenity"~"^(university|college)$"]["name"]', r: 8000, n: 4 },
    { id: 'mall', label: 'Shopping', q: 'nwr["shop"="mall"]["name"]', r: 12000, n: 4, exclude: /regus|office|cowork|business/i },
    { id: 'park', label: 'Parks', q: 'nwr["leisure"="park"]["name"]', r: 3000, n: 3 },
    { id: 'transport', label: 'Transport', q: 'nwr["aeroway"="aerodrome"]["iata"];nwr["railway"="station"]["name"]["station"!="subway"];nwr["amenity"="bus_station"]["name"]', r: 20000, n: 5,
      notable: /aerodrome|airport|jaipur junction/i, nearest: 3 },
];
const places = [];
// "jtm mall jagatpura" → "JTM Mall Jagatpura"; leaves already-cased names alone
const titleCase = (s) => (s === s.toLowerCase()
    ? s.replace(/\b\w/g, ch => ch.toUpperCase()).replace(/\bJtm\b/, 'JTM')
    : s);
for (const c of CATS) {
    console.log(`Fetching ${c.label}…`);
    const q = c.q.split(';').map(s => `${s}(around:${c.r},${origin[0]},${origin[1]});`).join('');
    const els = await overpass(`[out:json][timeout:90];(${q});out tags center;`);
    const seen = new Set();
    els.map(e => {
        const pos = e.type === 'node' ? [e.lat, e.lon] : [e.center.lat, e.center.lon];
        const name = (e.tags['name:en'] || e.tags.name).trim();
        let kind = c.id;
        if (c.id === 'transport') kind = e.tags.aeroway ? 'airport' : e.tags.railway ? 'railway' : 'bus';
        return { name, kind, cat: c.id, pos, d: haversine(origin, pos) };
    })
        .filter(p => /[a-z]/i.test(p.name) && !(c.exclude && c.exclude.test(p.name)))
        .filter(p => !/blood bank|nursing home|clinic/i.test(p.name))
        .filter(p => !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
        .sort((a, b) => a.d - b.d)
        .filter((p, i, arr) => {
            if (!c.notable) return true;
            return i < c.nearest || c.notable.test(p.name) || (p.kind === 'airport');
        })
        .slice(0, c.n)
        .forEach(p => places.push({ ...p, name: titleCase(p.name) }));
}

// Major roads nearby (connectivity)
console.log('Fetching major roads…');
const majors = await overpass(`[out:json][timeout:90];(way(around:3500,${origin[0]},${origin[1]})["highway"~"^(trunk|primary|secondary)$"]["name"];way(around:8000,${origin[0]},${origin[1]})["highway"~"^(trunk|primary)$"]["name"];);out tags center;`);
const roadsBest = new Map();
majors.forEach(w => {
    const name = (w.tags['name:en'] || w.tags.name).trim();
    if (!/[a-z]/i.test(name) || /circle|chauraha|flyover/i.test(name)) return;
    const d = haversine(origin, [w.center.lat, w.center.lon]);
    if (!roadsBest.has(name) || roadsBest.get(name).d > d) roadsBest.set(name, { name, pos: [w.center.lat, w.center.lon], d, type: w.tags.highway });
});
// nearest local links first, then the city arteries (trunk / primary)
const byDist = [...roadsBest.values()].sort((a, b) => a.d - b.d);
const roads = [...byDist.filter(r => r.type === 'secondary').slice(0, 3), ...byDist.filter(r => r.type !== 'secondary').slice(0, 4)]
    .sort((a, b) => a.d - b.d);

// ─── drive distance / time (OSRM) ────────────────────
async function osrm(path) {
    for (let i = 0; i < 4; i++) {
        const res = await fetch(`https://router.project-osrm.org/${path}`, { headers: UA }).catch(() => null);
        if (res?.ok) return res.json();
        await new Promise(r => setTimeout(r, 3000));
    }
    return null;
}
console.log('Routing…');
const coords = [origin, ...places.map(p => p.pos), ...roads.map(r => r.pos)].map(([la, ln]) => `${ln.toFixed(6)},${la.toFixed(6)}`).join(';');
const table = await osrm(`table/v1/driving/${coords}?sources=0&annotations=duration,distance`);
const all = [...places, ...roads];
all.forEach((p, i) => {
    const km = table?.distances?.[0]?.[i + 1];
    const s = table?.durations?.[0]?.[i + 1];
    p.driveKm = km != null ? Math.round(km / 100) / 10 : Math.round((p.d * 1.35) / 100) / 10;
    // OSRM's car profile assumes free-flowing roads; scale for Jaipur city traffic
    p.driveMin = s != null ? Math.max(1, Math.round((s / 60) * 1.4)) : Math.max(1, Math.round((p.d * 1.35) / 1000 / 22 * 60));
});

// Route geometry for the headline destinations
const keys = ['airport', 'railway', 'hospital', 'mall'].map(k => places.find(p => p.kind === k)).filter(Boolean);
for (const p of keys) {
    const r = await osrm(`route/v1/driving/${origin[1]},${origin[0]};${p.pos[1]},${p.pos[0]}?overview=simplified&geometries=geojson`);
    if (r?.routes?.[0]) p.route = r.routes[0].geometry.coordinates.map(([ln, la]) => [+la.toFixed(5), +ln.toFixed(5)]);
}

const round = (p) => [+p[0].toFixed(6), +p[1].toFixed(6)];
const out = {
    generated: new Date().toISOString().slice(0, 10),
    attribution: 'Places © OpenStreetMap contributors · Routing © OSRM',
    gate: round(gate),
    approach: { road: approach.road, lengthM: approach.lengthM, path: [round(gate), round(origin)] },
    categories: CATS.map(({ id, label }) => ({ id, label })),
    places: places.map(({ name, kind, cat, pos, d, driveKm, driveMin, route }) => ({
        name, kind, cat, pos: round(pos), km: Math.round(d / 100) / 10, driveKm, driveMin, ...(route ? { route } : {}),
    })),
    roads: roads.map(({ name, pos, d, driveKm, driveMin, type }) => ({ name, type, pos: round(pos), km: Math.round(d / 100) / 10, driveKm, driveMin })),
};
writeFileSync(new URL('src/shared/nearby.json', ROOT), JSON.stringify(out, null, 1));
console.log(`Wrote ${out.places.length} places, ${out.roads.length} roads → src/shared/nearby.json`);
