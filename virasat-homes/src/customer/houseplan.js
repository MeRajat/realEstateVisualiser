// Draws an indicative house layout (from shared/house-layout.js) as a clean architectural
// sheet: road at the bottom, plot + setbacks, rooms with sizes in feet-inches, north arrow.
const esc = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function feetInches(v) {
    let ft = Math.floor(v);
    let inch = Math.round((v - ft) * 12);
    if (inch === 12) { ft += 1; inch = 0; }
    return inch ? `${ft}'${inch}"` : `${ft}'`;
}

const FILL = {
    living: '#fdf6e9', lounge: '#fdf6e9', dining: '#fbf1dd', kitchen: '#fde8e1', bedroom: '#eaf2fb',
    toilet: '#e6f4f1', stairs: '#f1f1f1', pooja: '#fff1c9', store: '#f3efe8', study: '#eef0fb', balcony: '#f6f6f6',
};
const DIR_DEG = { North: 0, East: 90, South: 180, West: 270 };
// Compass side on the drawing's left / right (looking at the plot from the road) and top
const SIDES = {
    North: { left: 'East', right: 'West', top: 'South' },
    South: { left: 'West', right: 'East', top: 'North' },
    East: { left: 'South', right: 'North', top: 'West' },
    West: { left: 'North', right: 'South', top: 'East' },
};

export function renderHousePlan(layout, floorId, { roadName = '' } = {}) {
    const floor = layout.floors.find(f => f.id === floorId) || layout.floors[0];
    const F = layout.frontage, D = layout.depth;
    const pad = Math.max(6, F * 0.12);
    const roadH = Math.max(5, D * 0.08);
    const W = F + pad * 2, H = D + pad * 2 + roadH;
    const fs = Math.max(1.35, Math.min(2.6, Math.min(F, D) / 16)); // label size in feet
    const sx = (u) => pad + u;
    const sy = (v) => pad + (D - v);               // v = 0 (road) at the bottom
    const rect = (r, cls, fill) => `<rect x="${sx(r.x)}" y="${sy(r.y + r.h)}" width="${r.w}" height="${r.h}" class="${cls}"${fill ? ` fill="${fill}"` : ''}/>`;

    function label(r, name, showSize = true) {
        const cx = sx(r.x + r.w / 2), cy = sy(r.y + r.h / 2);
        const small = Math.min(r.w, r.h) < fs * 5;
        const f = small ? fs * 0.72 : fs;
        const fits = name.length * f * 0.5 < r.w * 0.95;
        const text = fits ? name : name.split(' ')[0];
        return `<text x="${cx}" y="${cy - (showSize ? f * 0.45 : 0)}" class="hp-name" font-size="${f}">${esc(text)}</text>
            ${showSize ? `<text x="${cx}" y="${cy + f * 0.85}" class="hp-size" font-size="${f * 0.78}">${feetInches(r.w)} × ${feetInches(r.h)}</text>` : ''}`;
    }

    const parts = [];
    // Road
    parts.push(`<rect x="0" y="${pad + D + pad * 0.25}" width="${W}" height="${roadH}" class="hp-road"/>
        <text x="${W / 2}" y="${pad + D + pad * 0.25 + roadH / 2}" class="hp-road-t" font-size="${fs * 0.85}">${esc(roadName ? `${roadName} · ` : '')}${esc(layout.facing.toUpperCase())} FACING</text>`);
    // Plot boundary + setback area
    parts.push(`<rect x="${sx(0)}" y="${sy(D)}" width="${F}" height="${D}" class="hp-plot"/>`);
    if (floor.id === 'ground') {
        layout.outdoor.forEach(o => {
            parts.push(rect(o, `hp-out hp-${o.kind}`));
            if (o.kind === 'parking') {
                // a simple car outline
                const cw = Math.min(o.w * 0.5, 7), ch = Math.min(o.h * 0.75, 14);
                const cx = sx(o.x + o.w / 2) - cw / 2, cy = sy(o.y + o.h / 2) - ch / 2;
                parts.push(`<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="${cw * 0.3}" class="hp-car"/>`);
            }
            parts.push(label(o, o.label, false));
        });
    }
    // Rooms
    floor.rooms.forEach(r => {
        parts.push(rect(r, `hp-room hp-${r.kind}`, FILL[r.kind]));
        if (r.kind === 'stairs') {
            const steps = Math.max(4, Math.round(r.h / 1));
            for (let i = 1; i < steps; i++) {
                const y = sy(r.y) - (r.h * i) / steps;
                parts.push(`<line x1="${sx(r.x)}" x2="${sx(r.x + r.w)}" y1="${y}" y2="${y}" class="hp-step"/>`);
            }
            parts.push(`<line x1="${sx(r.x + r.w / 2)}" x2="${sx(r.x + r.w / 2)}" y1="${sy(r.y) - r.h * 0.1}" y2="${sy(r.y + r.h) + r.h * 0.12}" class="hp-arrow" marker-end="url(#hp-arr)"/>`);
        }
    });
    // Attached toilets drawn over their bedrooms; label the bedroom in the remaining part
    floor.rooms.forEach(r => {
        if (r.toilet) {
            parts.push(rect(r.toilet, 'hp-room hp-toilet', FILL.toilet));
            parts.push(label(r.toilet, 'Toilet', false));
        }
    });
    floor.rooms.forEach(r => {
        if (r.kind === 'stairs') return parts.push(`<text x="${sx(r.x + r.w / 2)}" y="${sy(r.y + r.h * 0.5)}" class="hp-name hp-on" font-size="${fs * 0.72}">UP</text>`);
        let area = r;
        if (r.toilet) {
            // label the larger free strip of the bedroom
            const t = r.toilet;
            const beside = { x: t.x > r.x ? r.x : t.x + t.w, y: r.y, w: r.w - t.w, h: r.h };
            const above = { x: r.x, y: t.y > r.y ? r.y : t.y + t.h, w: r.w, h: r.h - t.h };
            area = beside.w * beside.h > above.w * above.h ? beside : above;
            parts.push(label(area, r.label, false));
            parts.push(`<text x="${sx(area.x + area.w / 2)}" y="${sy(area.y + area.h / 2) + fs * 1.05}" class="hp-size" font-size="${fs * 0.78}">${feetInches(r.w)} × ${feetInches(r.h)}</text>`);
            return;
        }
        parts.push(label(area, r.label, r.kind !== 'pooja'));
    });
    // Main door on the living room's road-side wall
    if (floor.id === 'ground') {
        const living = floor.rooms.find(r => r.door);
        if (living) {
            const dw = Math.min(4, living.w * 0.3);
            const dx = sx(living.x + living.w / 2 - dw / 2);
            parts.push(`<rect x="${dx}" y="${sy(living.y) - 0.4}" width="${dw}" height="0.8" class="hp-door"/>
                <path d="M${dx} ${sy(living.y)} a ${dw} ${dw} 0 0 0 ${dw} ${-dw}" class="hp-swing" transform="translate(0 0)"/>`);
        }
    }
    // House outline (thick walls)
    parts.push(`<rect x="${sx(layout.house.x)}" y="${sy(layout.house.y + layout.house.h)}" width="${layout.house.w}" height="${layout.house.h}" class="hp-walls"/>`);

    // Dimensions
    const dy = pad * 0.45;
    parts.push(`<line x1="${sx(0)}" x2="${sx(F)}" y1="${dy}" y2="${dy}" class="hp-dim" marker-start="url(#hp-tick)" marker-end="url(#hp-tick)"/>
        <text x="${sx(F / 2)}" y="${dy - fs * 0.45}" class="hp-dim-t" font-size="${fs * 0.85}">${feetInches(F)} frontage</text>
        <line x1="${pad * 0.45}" x2="${pad * 0.45}" y1="${sy(D)}" y2="${sy(0)}" class="hp-dim" marker-start="url(#hp-tick)" marker-end="url(#hp-tick)"/>
        <text x="${pad * 0.45 - fs * 0.45}" y="${sy(D / 2)}" class="hp-dim-t" font-size="${fs * 0.85}" transform="rotate(-90 ${pad * 0.45 - fs * 0.45} ${sy(D / 2)})">${feetInches(D)} depth</text>`);

    // Which direction each side of the plot faces
    const sd = SIDES[layout.facing];
    const lf = fs * 0.72;
    parts.push(`<text x="${sx(F / 2)}" y="${pad - lf * 0.9}" class="hp-side" font-size="${lf}">▲ ${sd.top.toUpperCase()}</text>
        <text x="${pad * 0.8}" y="${sy(D / 2)}" class="hp-side" font-size="${lf}" transform="rotate(-90 ${pad * 0.8} ${sy(D / 2)})">▲ ${sd.left.toUpperCase()}</text>
        <text x="${pad + F + pad * 0.5}" y="${sy(D / 2)}" class="hp-side" font-size="${lf}" transform="rotate(90 ${pad + F + pad * 0.5} ${sy(D / 2)})">▲ ${sd.right.toUpperCase()}</text>`);

    // North arrow: "up" on this drawing points away from the road
    const rot = (360 - DIR_DEG[layout.upDir]) % 360;
    const nx = W - pad * 0.55, ny = pad * 0.55, nr = Math.min(pad * 0.38, fs * 2.2);
    parts.push(`<g transform="translate(${nx} ${ny}) rotate(${rot})">
        <circle r="${nr}" class="hp-north-c"/>
        <path d="M0 ${-nr * 0.8} L${nr * 0.38} ${nr * 0.45} L0 ${nr * 0.18} L${-nr * 0.38} ${nr * 0.45} Z" class="hp-north"/>
        <text y="${-nr * 1.15}" class="hp-north-t" font-size="${fs * 0.8}" transform="rotate(${-rot} 0 ${-nr * 1.15})">N</text>
    </g>`);

    return `<svg viewBox="0 0 ${W} ${H}" class="house-plan" role="img" aria-label="${esc(floor.name)} layout, ${layout.bedrooms} bedrooms">
        <defs>
            <marker id="hp-arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#5f6368"/></marker>
            <marker id="hp-tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4"><path d="M5 0v10" stroke="#5f6368" stroke-width="2"/></marker>
        </defs>
        <rect width="${W}" height="${H}" class="hp-paper"/>
        ${parts.join('')}
    </svg>`;
}
