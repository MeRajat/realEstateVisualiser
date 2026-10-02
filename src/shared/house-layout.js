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
    // Stairs on the outer wall side, toilet towards the centre
    if (!deep || livingCol !== 0) {
        stairs.x = mid.core.x;
        commonToilet.x = mid.core.x + stairs.w;
    } else {
        stairs.x = mid.core.x + mid.core.w - stairs.w;
        commonToilet.x = mid.core.x;
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
