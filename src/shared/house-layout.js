// Indicative house layout for a plot: setbacks, a ground + first floor, Vastu-friendly room
// placement and a summary. Pure function of the plot's size and road-facing side, so every
// plot gets one without any hand-made data. Units are feet.
//
// Local frame: u runs along the road frontage (0 = your left when standing on the road
// looking at the plot), v runs away from the road (0 = road edge, D = back boundary).

const OPPOSITE = { North: 'South', South: 'North', East: 'West', West: 'East' };

// Which compass side each local edge faces, per road-facing direction
const EDGES = {
    North: { u0: 'East', uF: 'West', v0: 'North', vD: 'South' },
    South: { u0: 'West', uF: 'East', v0: 'South', vD: 'North' },
    East: { u0: 'South', uF: 'North', v0: 'East', vD: 'West' },
    West: { u0: 'North', uF: 'South', v0: 'West', vD: 'East' },
};
const SHORT = { North: 'N', South: 'S', East: 'E', West: 'W' };
const cornerName = (a, b) => {
    const s = new Set([SHORT[a], SHORT[b]]);
    return (s.has('N') ? 'N' : 'S') + (s.has('E') ? 'E' : 'W');
};

const r1 = (n) => Math.round(n * 10) / 10;
const area = (r) => r.w * r.h;

// Corner plots have two roads: build towards the one that gives a normal, deep plot
// (narrow frontage, long depth) — that is how most houses on such plots are designed.
export function chooseFacing(plot) {
    const dims = plot.dims || { w: plot.box.w, h: plot.box.h };
    const options = plot.facing.length ? plot.facing.map(f => f.dir) : ['South'];
    const ratio = (dir) => (dir === 'North' || dir === 'South' ? dims.h / dims.w : dims.w / dims.h);
    return options.slice().sort((a, b) => ratio(b) - ratio(a))[0];
}

export function generateHouseLayout(plot) {
    const facing = chooseFacing(plot);
    const edges = EDGES[facing];
    // Frontage is the side along the road
    const alongX = facing === 'North' || facing === 'South';
    const dims = plot.dims || { w: plot.box.w, h: plot.box.h };
    const F = alongX ? dims.w : dims.h;
    const D = alongX ? dims.h : dims.w;

    // Setbacks scale with the plot (typical for 150–300 gaj residential plots)
    const front = D >= 60 ? 10 : D >= 45 ? 8 : 6;
    const rear = D >= 60 ? 6 : D >= 45 ? 5 : 3;
    const side = F >= 40 ? 4 : F >= 32 ? 3 : 0;
    // Large plots: keep a home-sized footprint centred on the frontage, the rest is lawn
    const maxW = 46, maxH = 48;
    const hw = Math.min(F - side * 2, maxW);
    const hh = Math.min(D - front - rear, maxH);
    const house = { x: r1((F - hw) / 2), y: front, w: r1(hw), h: r1(hh) };

    // Deep houses: 2 columns × 3 rows (living → dining → bedrooms going back).
    // Wide, shallow houses: 3 columns × 2 rows (rooms side by side along the road).
    const deep = house.h >= house.w * 0.85;
    const C = deep ? 2 : 3;
    const R = deep ? 3 : 2;
    const rows = (deep ? [0.36, 0.28, 0.36] : [0.5, 0.5]).map(f => f * house.h);
    const rowY = rows.map((_, i) => house.y + rows.slice(0, i).reduce((s, h) => s + h, 0));
    // Corners: which compass corner each house corner is
    const corners = {
        fl: { col: 0, row: 0, name: cornerName(edges.u0, edges.v0) },
        fr: { col: C - 1, row: 0, name: cornerName(edges.uF, edges.v0) },
        bl: { col: 0, row: R - 1, name: cornerName(edges.u0, edges.vD) },
        br: { col: C - 1, row: R - 1, name: cornerName(edges.uF, edges.vD) },
    };
    const byCompass = Object.fromEntries(Object.entries(corners).map(([k, c]) => [c.name, k]));

    // Room priorities: living at the front on the N/E side (entrance), kitchen in the SE
    // (else NW), master bedroom in the SW, the remaining corner becomes bedroom 2.
    const taken = new Set();
    const take = (k) => { taken.add(k); return k; };
    const ENTRANCE_PREF = { NE: 3, NW: 2, SE: 1, SW: 0 }; // best entrance corner first
    const livingKey = take(['fl', 'fr'].sort((a, b) => ENTRANCE_PREF[corners[b].name] - ENTRANCE_PREF[corners[a].name])[0]);
    const kitchenKey = take(!taken.has(byCompass.SE) ? byCompass.SE : !taken.has(byCompass.NW) ? byCompass.NW : ['fl', 'fr', 'bl', 'br'].find(k => !taken.has(k)));
    const masterKey = take(!taken.has(byCompass.SW) ? byCompass.SW : ['bl', 'br', 'fl', 'fr'].find(k => !taken.has(k)));
    const bed2Key = take(['fl', 'fr', 'bl', 'br'].find(k => !taken.has(k)));

    // Living's column gets the wider share
    const livingCol = corners[livingKey].col;
    const otherCol = C - 1 - livingCol;
    const shares = deep ? (livingCol === 0 ? [0.56, 0.44] : [0.44, 0.56]) : [0.38, 0.24, 0.38];
    const colW = shares.map(f => f * house.w);
    const colX = colW.map((_, i) => house.x + colW.slice(0, i).reduce((s, w) => s + w, 0));
    const cell = (k) => {
        const c = corners[k];
        return { x: colX[c.col], y: rowY[c.row], w: colW[c.col], h: rows[c.row] };
    };
    const gridCell = (col, row) => ({ x: colX[col], y: rowY[row], w: colW[col], h: rows[row] });

    // Attached toilet: tucked in the corner of the bedroom nearest the house centre (plumbing core)
    function attachToilet(room) {
        const tw = Math.min(room.w * 0.42, 7.5);
        const th = Math.min(room.h * 0.4, 8);
        const nearCentreX = room.x + room.w / 2 < house.x + house.w / 2 ? room.x + room.w - tw : room.x;
        const nearCentreY = room.y < rowY[1] ? room.y + room.h - th : room.y;
        return { x: nearCentreX, y: nearCentreY, w: tw, h: th };
    }

    // Dining + the stairs/toilet core sit between the corner rooms
    const mid = deep
        ? { dining: gridCell(livingCol, 1), core: gridCell(otherCol, 1) }
        : { dining: gridCell(1, 0), core: gridCell(1, 1) };
    const stairs = { ...mid.core, w: mid.core.w * 0.58 };
    const commonToilet = { ...mid.core, x: mid.core.x + mid.core.w * 0.58, w: mid.core.w * 0.42 };
    // Toilet on the outer wall, stairs towards the inside — Vastu keeps toilets away from
    // the centre of the house (Brahmasthan); the outer wall also gives it a window
    const coreOnLeft = deep ? otherCol === 0 : true;
    if (coreOnLeft) {
        commonToilet.x = mid.core.x;
        stairs.x = mid.core.x + commonToilet.w;
    } else {
        stairs.x = mid.core.x;
        commonToilet.x = mid.core.x + stairs.w;
    }

    const room = (kind, label, rect, extra = {}) => ({ kind, label, ...roundRect(rect), ...extra });
    const masterCell = cell(masterKey);
    const bed2Cell = cell(bed2Key);
    const masterToilet = attachToilet(masterCell);
    const bed2Toilet = attachToilet(bed2Cell);
    const livingCell = cell(livingKey);

    // Pooja nook in the north-east corner of whichever living/bedroom space holds it
    const neKey = byCompass.NE;
    let pooja = null;
    if (neKey && (neKey === livingKey || neKey === bed2Key)) {
        const c = cell(neKey);
        const s = Math.min(4.5, c.w * 0.3, c.h * 0.3);
        const atRight = corners[neKey].col === C - 1;
        const atFront = corners[neKey].row === 0;
        pooja = { x: atRight ? c.x + c.w - s : c.x, y: atFront ? c.y : c.y + c.h - s, w: s, h: s };
    }

    // Front open space: parking in front of the non-living column, garden / sit-out in front of living
    const outdoor = [];
    if (front >= 6) {
        outdoor.push(room('parking', 'Parking', { x: colX[otherCol], y: 0, w: colW[otherCol], h: front }));
        const sitCols = deep ? [livingCol] : [livingCol, 1];
        const sx0 = Math.min(...sitCols.map(c => colX[c]));
        outdoor.push(room('garden', 'Sit-out', { x: sx0, y: 0, w: sitCols.reduce((s, c) => s + colW[c], 0), h: front }));
    }

    // Kitchen keeps a realistic depth on the side next to the dining area; the rest of that
    // corner becomes a store (small) or a guest room (large enough to sleep in)
    const kCell = cell(kitchenKey);
    const kFront = corners[kitchenKey].row === 0;
    const kDepth = Math.min(kCell.h, 12);
    const kitchenRect = { ...kCell, h: kDepth, y: kFront ? kCell.y + kCell.h - kDepth : kCell.y };
    const spare = { ...kCell, h: kCell.h - kDepth, y: kFront ? kCell.y : kCell.y + kDepth };
    const spareRoom = spare.h >= 5 ? (area(spare) >= 90 && spare.h >= 8
        ? room('bedroom', 'Guest Room', spare) : room('store', 'Store', spare)) : null;

    const backGap = D - rear - (house.y + house.h);
    if (backGap >= 6) outdoor.push(room('garden', 'Lawn', { x: house.x, y: house.y + house.h, w: house.w, h: backGap }));

    const ground = [
        room('living', 'Living', livingCell, { door: true }),
        room('kitchen', 'Kitchen', spare.h >= 5 ? kitchenRect : kCell),
        ...(spareRoom ? [spareRoom] : []),
        room('bedroom', 'Master Bedroom', masterCell, { toilet: roundRect(masterToilet) }),
        room('bedroom', 'Bedroom 2', bed2Cell, { toilet: roundRect(bed2Toilet) }),
        room('dining', 'Dining', mid.dining),
        room('stairs', 'Stairs', stairs),
        room('toilet', 'Toilet', commonToilet),
        ...(pooja ? [room('pooja', 'Pooja', pooja)] : []),
    ];

    // First floor: same structure, bedrooms over bedrooms, lounge over living, balcony over the front setback
    // Bedrooms over bedrooms; over the kitchen a study; small houses keep one study upstairs
    const small = house.w * house.h < 650;
    const first = [
        room('lounge', 'Family Lounge', livingCell),
        room('study', small ? 'Study' : 'Study / Gym', kCell),
        room('bedroom', 'Bedroom 3', masterCell, { toilet: roundRect(attachToilet(masterCell)) }),
        small ? room('study', 'Kids Room', bed2Cell) : room('bedroom', 'Bedroom 4', bed2Cell, { toilet: roundRect(attachToilet(bed2Cell)) }),
        room('lounge', 'Open Terrace', mid.dining),
        room('stairs', 'Stairs', stairs),
        room('toilet', 'Toilet', commonToilet),
        ...(front >= 6 ? [room('balcony', 'Balcony', { x: house.x, y: house.y - Math.min(4, front - 2), w: house.w, h: Math.min(4, front - 2) })] : []),
    ];

    const bedrooms = ground.filter(r => r.kind === 'bedroom' && r.label !== 'Guest Room').length + first.filter(r => r.kind === 'bedroom').length;
    const perFloor = Math.round(house.w * house.h);
    const vastu = [
        { ok: corners[kitchenKey].name === 'SE', text: `Kitchen in the ${pretty(corners[kitchenKey].name)}` },
        { ok: corners[masterKey].name === 'SW', text: `Master bedroom in the ${pretty(corners[masterKey].name)}` },
        ...(pooja ? [{ ok: true, text: 'Pooja corner in the North-East' }] : []),
        { ok: facing === 'North' || facing === 'East', text: `Main entrance on the ${facing.toLowerCase()} side` },
    ];

    return {
        facing, frontage: r1(F), depth: r1(D),
        setbacks: { front, rear, side },
        house: roundRect(house),
        outdoor,
        floors: [
            { id: 'ground', name: 'Ground floor', rooms: ground },
            { id: 'first', name: 'First floor', rooms: first },
        ],
        bedrooms,
        builtUp: perFloor * 2,
        perFloor,
        vastu,
        upDir: OPPOSITE[facing], // compass direction pointing "up" on the drawing (away from the road)
        roadName: plot.facing.find(f => f.dir === facing)?.road || '',
    };
}

function roundRect(r) {
    return { x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) };
}
function pretty(c) {
    return { NE: 'North-East', NW: 'North-West', SE: 'South-East', SW: 'South-West' }[c] || c;
}

/** Map a local (u, v) point to plan coordinates for drawing the house on the site. */
export function localToPlan(plot, u, v) {
    const facing = chooseFacing(plot);
    const b = plot.box;
    const dims = plot.dims || { w: b.w, h: b.h };
    const alongX = facing === 'North' || facing === 'South';
    // scale local feet onto the drawn polygon (dims are area-corrected, the box is as drawn)
    const su = (alongX ? b.w : b.h) / (alongX ? dims.w : dims.h);
    const sv = (alongX ? b.h : b.w) / (alongX ? dims.h : dims.w);
    u *= su;
    v *= sv;
    switch (facing) {
        case 'North': return [b.maxX - u, b.minY + v];
        case 'South': return [b.minX + u, b.maxY - v];
        case 'East': return [b.maxX - v, b.maxY - u];
        default: return [b.minX + v, b.minY + u]; // West
    }
}

// ─── VASTU ───────────────────────────────────────────
// Traditional Vastu Purusha Mandala: the plot is read as a 3×3 grid of directions.
export const VASTU_ZONES = {
    NE: { name: 'Ishanya', use: 'Water, prayer — keep light & open', tint: '#4285f4' },
    E: { name: 'Indra', use: 'Entrance, living, morning sun', tint: '#34a853' },
    SE: { name: 'Agni', use: 'Fire — kitchen', tint: '#ea4335' },
    S: { name: 'Yama', use: 'Rest, heavy storage, stairs', tint: '#a142f4' },
    SW: { name: 'Nairutya', use: 'Master bedroom — heaviest part', tint: '#8d6e63' },
    W: { name: 'Varuna', use: "Dining, children's room, study", tint: '#00acc1' },
    NW: { name: 'Vayu', use: 'Guests, toilets, storage', tint: '#9aa0a6' },
    N: { name: 'Kubera', use: 'Wealth — entrance, living, cash', tint: '#fbbc04' },
    C: { name: 'Brahmasthan', use: 'Centre — keep open, no toilet or stairs', tint: '#f9ab00' },
};

const FACING_NOTES = {
    East: 'East-facing plots are considered highly auspicious in Vastu: the morning sun enters the main door, associated with health and growth.',
    North: 'North-facing plots are linked to Kubera, the lord of wealth, and are considered very good for prosperity.',
    West: 'West-facing plots are considered good for stability and business when the main door is in the north half of the west side.',
    South: 'South-facing plots are fine when planned well: keep the main door towards the south-east and the south-west corner the heaviest part of the house.',
};

// Compass zone of a local (u, v) point, for a given road-facing direction
export function zoneAt(facing, F, D, u, v) {
    const e = EDGES[facing];
    const third = (t, len) => (t < len / 3 ? 0 : t > (2 * len) / 3 ? 2 : 1);
    const iu = third(u, F), iv = third(v, D);
    const part = (i, a, b) => (i === 0 ? a : i === 2 ? b : null);
    const dirs = [part(iu, e.u0, e.uF), part(iv, e.v0, e.vD)].filter(Boolean);
    if (!dirs.length) return 'C';
    const ns = dirs.find(d => d === 'North' || d === 'South');
    const ew = dirs.find(d => d === 'East' || d === 'West');
    return (ns ? SHORT[ns] : '') + (ew ? SHORT[ew] : '');
}

// Grid of the 9 zones in local coordinates (for drawing the mandala over the plan)
export function vastuGrid(layout) {
    const { facing, frontage: F, depth: D } = layout;
    const cells = [];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            const r = { x: (F / 3) * i, y: (D / 3) * j, w: F / 3, h: D / 3 };
            cells.push({ ...r, zone: zoneAt(facing, F, D, r.x + r.w / 2, r.y + r.h / 2) });
        }
    }
    return cells;
}

const RULES = {
    living: { label: 'Living room', ideal: ['N', 'E', 'NE'], ok: ['NW', 'C'], tip: 'Keep heavy sofas on the south and west walls.' },
    kitchen: { label: 'Kitchen', ideal: ['SE'], ok: ['NW', 'E'], tip: 'Place the stove so the cook faces east.' },
    master: { label: 'Master bedroom', ideal: ['SW'], ok: ['S', 'W'], tip: 'Sleep with your head towards the south.' },
    bedroom: { label: 'Second bedroom', ideal: ['W', 'S', 'NW'], ok: ['SW', 'N', 'E', 'SE'], tip: "Good for children's or guest room." },
    pooja: { label: 'Pooja', ideal: ['NE'], ok: ['E', 'N'], avoid: ['S', 'SW', 'SE'], tip: 'Face east or north while praying.' },
    stairs: { label: 'Staircase', ideal: ['S', 'W', 'SW'], ok: ['SE', 'NW'], avoid: ['NE', 'C'], tip: 'Stairs should turn clockwise going up.' },
    toilet: { label: 'Toilets', ideal: ['NW', 'W', 'S'], ok: ['SE', 'E', 'N'], avoid: ['NE', 'C', 'SW'], tip: 'Keep the toilet door closed and the seat facing north–south.' },
    dining: { label: 'Dining', ideal: ['W', 'E', 'C'], ok: ['N', 'S', 'NW'], tip: 'Sit facing east or north while eating.' },
};
const REMEDY = {
    kitchen: 'If the kitchen cannot be in the south-east, keep the stove in the south-east corner of the kitchen.',
    master: 'Keep the bed in the south-west part of the room and heavy wardrobes on the south-west walls.',
    pooja: 'A small pooja unit on the north-east wall of the living room works well.',
    stairs: 'Avoid stairs in the north-east; use the south or west side.',
    toilet: 'A pyramid or sea-salt bowl is a common Vastu remedy for a toilet in the wrong zone.',
    living: 'Keep this room light and uncluttered, with the entrance wall bright.',
    dining: 'Keep the centre of the house open and well lit.',
    bedroom: 'Place the bed so you sleep with your head to the south or east.',
};

export function vastuReport(layout) {
    const { facing, frontage: F, depth: D } = layout;
    const rooms = layout.floors[0].rooms;
    const zoneOf = (r) => zoneAt(facing, F, D, r.x + r.w / 2, r.y + r.h / 2);
    const items = [];
    const check = (kind, room, labelOverride) => {
        if (!room) return;
        const rule = RULES[kind];
        const zone = zoneOf(room);
        const status = rule.ideal.includes(zone) ? 'ideal' : (rule.avoid || []).includes(zone) ? 'avoid' : rule.ok.includes(zone) ? 'ok' : 'ok';
        items.push({ key: kind, label: labelOverride || rule.label, zone, zoneName: VASTU_ZONES[zone].name, status, tip: status === 'ideal' ? rule.tip : REMEDY[kind] });
    };

    // Main entrance: the door sits on the road side of the living room. Better halves:
    // East/West plots → north half; North/South plots → east half.
    const living = rooms.find(r => r.door);
    const doorZone = living ? zoneAt(facing, F, D, living.x + living.w / 2, 0) : null;
    const goodHalf = { East: 'N', West: 'N', North: 'E', South: 'E' }[facing];
    const doorGood = doorZone && doorZone.includes(goodHalf);
    const entranceStatus = (facing === 'East' || facing === 'North') ? (doorGood ? 'ideal' : 'ok') : (doorGood ? 'ok' : 'avoid');
    items.push({
        key: 'entrance', label: 'Main entrance', zone: doorZone, zoneName: VASTU_ZONES[doorZone]?.name, status: entranceStatus,
        tip: doorGood
            ? `Door placed in the ${goodHalf === 'N' ? 'north' : 'east'} half of the ${facing.toLowerCase()} side — the favourable part of this wall.`
            : `Shift the main door towards the ${goodHalf === 'N' ? 'north' : 'east'} half of the ${facing.toLowerCase()} side.`,
    });

    check('living', living);
    check('kitchen', rooms.find(r => r.kind === 'kitchen'));
    check('master', rooms.find(r => r.label === 'Master Bedroom'));
    check('bedroom', rooms.find(r => r.label === 'Bedroom 2'));
    check('pooja', rooms.find(r => r.kind === 'pooja'));
    check('stairs', rooms.find(r => r.kind === 'stairs'));
    // Toilets: report the worst-placed one
    const toilets = [...rooms.filter(r => r.kind === 'toilet'), ...rooms.filter(r => r.toilet).map(r => r.toilet)];
    const rank = { avoid: 0, ok: 1, ideal: 2 };
    const tItems = toilets.map(t => {
        const z = zoneOf(t);
        const rule = RULES.toilet;
        return { z, s: rule.ideal.includes(z) ? 'ideal' : rule.avoid.includes(z) ? 'avoid' : 'ok' };
    }).sort((a, b) => rank[a.s] - rank[b.s]);
    if (tItems.length) {
        const w = tItems[0];
        items.push({ key: 'toilet', label: 'Toilets', zone: w.z, zoneName: VASTU_ZONES[w.z].name, status: w.s, tip: w.s === 'ideal' ? RULES.toilet.tip : REMEDY.toilet });
    }
    // Brahmasthan: what sits at the centre of the house
    const H = layout.house;
    const centre = rooms.find(r => r.kind !== 'pooja' && H.x + H.w / 2 >= r.x && H.x + H.w / 2 <= r.x + r.w && H.y + H.h / 2 >= r.y && H.y + H.h / 2 <= r.y + r.h);
    const heavy = centre && ['toilet', 'stairs', 'kitchen'].includes(centre.kind);
    items.push({
        key: 'centre', label: 'Centre (Brahmasthan)', zone: 'C', zoneName: 'Brahmasthan', status: heavy ? 'avoid' : 'ideal',
        tip: heavy ? `Move the ${centre.label.toLowerCase()} away from the centre and keep it open.` : `The centre is the ${centre ? centre.label.toLowerCase() : 'open area'} — open and free, as recommended.`,
    });

    const pts = { ideal: 1, ok: 0.6, avoid: 0 };
    const weights = { entrance: 1.5, kitchen: 1.5, master: 1.5, centre: 1.2, pooja: 1, stairs: 1, toilet: 1, living: 0.8, bedroom: 0.5 };
    let got = 0, max = 0;
    items.forEach(i => { const w = weights[i.key] || 0.5; got += pts[i.status] * w; max += w; });
    // Facing adds a small bonus/penalty as traditionally perceived
    const facingAdj = { East: 0.4, North: 0.4, West: 0, South: -0.4 }[facing];
    const score = Math.max(1, Math.min(10, Math.round(((got / max) * 10 + facingAdj) * 2) / 2));
    const label = score >= 9 ? 'Excellent' : score >= 7.5 ? 'Very good' : score >= 6 ? 'Good' : 'Needs care';
    return { score, label, facingNote: FACING_NOTES[facing], items };
}
