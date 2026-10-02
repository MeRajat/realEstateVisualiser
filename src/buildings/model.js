// Derives every unit (id, position, facing, status, price) from the society config.
// No three.js here — this module is part of the small first-load bundle.
import { society } from './society.js';

const DIRS = ['N', 'E', 'S', 'W'];
export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const DIR_NAMES = {
    N: 'North', NE: 'North-East', E: 'East', SE: 'South-East',
    S: 'South', SW: 'South-West', W: 'West', NW: 'North-West',
};
export const DIR_DEG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const norm360 = (d) => ((d % 360) + 360) % 360;
export const compass8 = (deg) => COMPASS8[Math.round(norm360(deg) / 45) % 8];

// Rotate a tower-local (x, z) offset clockwise by `deg` (x east, z south)
export function rotateXZ(x, z, deg) {
    const r = (deg * Math.PI) / 180;
    const c = Math.round(Math.cos(r) * 1e9) / 1e9;
    const s = Math.round(Math.sin(r) * 1e9) / 1e9;
    return [x * c - z * s, x * s + z * c];
}

const turn = (facing, deg) => DIRS[(DIRS.indexOf(facing) + Math.round(deg / 90)) % 4];

// FNV-1a → [0, 1): stable sample statuses across reloads
function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
}

function statusFor(id) {
    if (society.status[id]) return society.status[id];
    const mix = society.sampleMix;
    if (!mix) return 'Available';
    const r = hash01(id);
    if (r < mix.sold) return 'Sold';
    if (r < mix.sold + mix.booked) return 'Booked';
    return 'Available';
}

function priceFor(floor, facing, tags, type) {
    const p = society.pricing;
    const rise = p.floorRise.perFloor * Math.max(0, floor - p.floorRise.fromFloor + 1);
    const premiums = tags
        .filter(t => p.premiums[t])
        .map(t => ({ label: t.replace(/-/g, ' '), amount: p.premiums[t] }));
    if (p.facingPremium?.[facing]) premiums.push({ label: `${DIR_NAMES[facing].toLowerCase()} facing`, amount: p.facingPremium[facing] });
    const rate = p.basePerSqft + rise + premiums.reduce((s, x) => s + x.amount, 0);
    return { rate, rise, premiums, total: rate * type.superArea };
}

export const towers = society.towers.map(t => {
    // Footprint of one floor (tower-local), used for slabs/cores/pillars
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    t.layout.forEach(u => {
        const type = society.unitTypes[u.type];
        const sideways = u.facing === 'E' || u.facing === 'W';
        const hw = (sideways ? type.depth : type.width) / 2;
        const hd = (sideways ? type.width : type.depth) / 2;
        minX = Math.min(minX, u.x - hw); maxX = Math.max(maxX, u.x + hw);
        minZ = Math.min(minZ, u.z - hd); maxZ = Math.max(maxZ, u.z + hd);
    });
    return { ...t, footprint: { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ } };
});

const firstFloor = society.stiltParking ? 1 : 0;

export const units = [];
towers.forEach(t => {
    for (let floor = firstFloor; floor < firstFloor + t.floors; floor++) {
        t.layout.forEach(slot => {
            const type = society.unitTypes[slot.type];
            const id = `${t.id}-${floor}${String(slot.pos).padStart(2, '0')}`;
            // siteFacing: cardinal in the (axis-aligned) site frame — used by the 3D scene.
            // facing/bearing: true compass direction on Earth — shown to buyers & priced.
            const siteFacing = turn(slot.facing, t.rotation);
            const bearing = norm360(DIR_DEG[siteFacing] + (society.siteRotation || 0));
            const facing = compass8(bearing);
            const sideways = slot.facing === 'E' || slot.facing === 'W';
            const [ox, oz] = rotateXZ(slot.x, slot.z, t.rotation);
            const tags = slot.tags || [];
            units.push({
                id,
                tower: t,
                floor,
                pos: slot.pos,
                typeId: slot.type,
                type,
                bhk: type.bhk,
                facing,
                bearing,
                siteFacing,
                localFacing: slot.facing,
                tags,
                status: statusFor(id),
                ...priceFor(floor, facing, tags, type),
                // Box in tower-local axes + world centre
                local: { x: slot.x, z: slot.z, w: sideways ? type.depth : type.width, d: sideways ? type.width : type.depth },
                world: { x: t.x + ox, z: t.z + oz, y: floor * society.floorHeight },
            });
        });
    }
});

export const unitById = new Map(units.map(u => [u.id, u]));

export const stats = {
    total: units.length,
    available: units.filter(u => u.status === 'Available').length,
    minRate: Math.min(...units.map(u => u.rate)),
    maxFloor: Math.max(...towers.map(t => t.floors)) + firstFloor - 1,
    firstFloor,
};

// ─── FILTERS ─────────────────────────────────────────
const lakhStep = (v) => Math.round(v / 500000) * 500000;
const sortedTotals = units.map(u => u.total).sort((a, b) => a - b);
const q1 = lakhStep(sortedTotals[Math.floor(sortedTotals.length / 3)]);
const q2 = lakhStep(sortedTotals[Math.floor((sortedTotals.length * 2) / 3)]);

export const BUDGETS = [
    { id: 'b1', label: `Under ${formatMoney(q1)}`, test: v => v < q1 },
    { id: 'b2', label: `${formatMoney(q1)} – ${formatMoney(q2)}`, test: v => v >= q1 && v <= q2 },
    { id: 'b3', label: `Above ${formatMoney(q2)}`, test: v => v > q2 },
];

export const FLOOR_BANDS = (() => {
    const top = stats.maxFloor;
    const a = Math.round(top / 3);
    const b = Math.round((top * 2) / 3);
    return [
        { id: 'low', label: `Floors ${firstFloor}–${a}`, test: f => f <= a },
        { id: 'mid', label: `Floors ${a + 1}–${b}`, test: f => f > a && f <= b },
        { id: 'high', label: `Floors ${b + 1}+`, test: f => f > b },
    ];
})();

export const DEFAULT_FILTER = { bhk: 'all', status: 'all', tower: 'all', budget: 'all', floors: 'all', facing: 'all' };

export function matches(u, f) {
    if (f.bhk !== 'all' && String(u.bhk) !== f.bhk) return false;
    if (f.status !== 'all' && u.status !== f.status) return false;
    if (f.tower !== 'all' && u.tower.id !== f.tower) return false;
    if (f.budget !== 'all' && !BUDGETS.find(b => b.id === f.budget).test(u.total)) return false;
    if (f.floors !== 'all' && !FLOOR_BANDS.find(b => b.id === f.floors).test(u.floor)) return false;
    if (f.facing !== 'all' && u.facing !== f.facing) return false;
    return true;
}

// ─── FORMATTING ──────────────────────────────────────
export function formatMoney(v) {
    if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 1 : 2).replace(/\.?0+$/, '')} Cr`;
    if (v >= 1e5) return `₹${(v / 1e5).toFixed(1).replace(/\.0$/, '')} L`;
    return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

export const formatRate = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;

export function ordinal(n) {
    if (n === 0) return 'Ground';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export { society };
