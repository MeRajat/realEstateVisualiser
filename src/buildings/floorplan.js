// Generates a 2D SVG floor plan for a unit type from its room rectangles.
import { DIR_DEG, DIR_NAMES } from './model.js';

const FILL = {
    living: '#1d3a2f',
    bed: '#1b3140',
    kitchen: '#3a3020',
    bath: '#22343a',
    balcony: '#25402a',
    foyer: '#2a2f2c',
    utility: '#2a2f2c',
};

const DOOR = 3; // ft
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ft = (v) => `${Math.round(v * 10) / 10}′`;

function door(room) {
    const d = room.door;
    if (!d) return '';
    const { x, y, w, h } = room;
    const at = d.at ?? 0.5;
    let x1, y1, x2, y2, arc;
    if (d.side === 'N' || d.side === 'S') {
        const yy = d.side === 'N' ? y : y + h;
        const cx = Math.min(Math.max(x + w * at, x + DOOR / 2 + 0.4), x + w - DOOR / 2 - 0.4);
        [x1, y1, x2, y2] = [cx - DOOR / 2, yy, cx + DOOR / 2, yy];
        const sweep = d.side === 'N' ? 1 : 0;
        const dy = d.side === 'N' ? DOOR : -DOOR;
        arc = `M${x1} ${yy} L${x1} ${yy + dy} A${DOOR} ${DOOR} 0 0 ${sweep} ${x2} ${yy}`;
    } else {
        const xx = d.side === 'W' ? x : x + w;
        const cy = Math.min(Math.max(y + h * at, y + DOOR / 2 + 0.4), y + h - DOOR / 2 - 0.4);
        [x1, y1, x2, y2] = [xx, cy - DOOR / 2, xx, cy + DOOR / 2];
        const dx = d.side === 'W' ? DOOR : -DOOR;
        const sweep = d.side === 'W' ? 0 : 1;
        arc = `M${xx} ${y1} L${xx + dx} ${y1} A${DOOR} ${DOOR} 0 0 ${sweep} ${xx} ${y2}`;
    }
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="fp-gap"/>
        <path d="${arc}" class="fp-swing"/>`;
}

function roomLabel(r) {
    const size = Math.max(0.9, Math.min(1.6, r.w / 7, r.h / 3.2));
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return `<text x="${cx}" y="${cy - size * 0.25}" font-size="${size}" class="fp-name">${esc(r.name)}</text>
        <text x="${cx}" y="${cy + size * 0.95}" font-size="${size * 0.78}" class="fp-dim">${ft(r.w)} × ${ft(r.h)}</text>`;
}

export function floorPlanSVG(type, { facing = 'N', title = '' } = {}) {
    const W = type.width;
    const D = type.depth;
    const pad = 5;
    const top = 8;
    // The plan's top edge is the unit's facing side, so north points `-facing` degrees from up
    const north = -DIR_DEG[facing];
    const balcony = type.rooms.filter(r => r.kind === 'balcony');
    return `<svg class="floorplan" viewBox="${-pad} ${-top} ${W + pad * 2} ${D + top + pad + 2}" role="img"
        aria-label="${esc(title || type.name)} floor plan, ${W} by ${D} feet, front faces ${DIR_NAMES[facing]}">
        <defs>
            <pattern id="fp-hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="1.2" stroke="rgba(255,255,255,0.08)" stroke-width="0.4"/>
            </pattern>
            <marker id="fp-tick" viewBox="0 0 2 2" refX="1" refY="1" markerWidth="2" markerHeight="2" orient="auto">
                <line x1="1" y1="0" x2="1" y2="2" stroke="#7d8c84" stroke-width="0.35"/>
            </marker>
        </defs>
        <rect x="0" y="0" width="${W}" height="${D}" class="fp-floor"/>
        ${type.rooms.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${FILL[r.kind] || FILL.foyer}" class="fp-room"/>`).join('')}
        ${balcony.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="url(#fp-hatch)"/>`).join('')}
        ${type.rooms.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" class="fp-wall"/>`).join('')}
        <rect x="0" y="0" width="${W}" height="${D}" class="fp-outer"/>
        ${type.rooms.map(door).join('')}
        ${type.rooms.map(roomLabel).join('')}
        <line x1="0" y1="-2.6" x2="${W}" y2="-2.6" class="fp-measure" marker-start="url(#fp-tick)" marker-end="url(#fp-tick)"/>
        <text x="${W / 2}" y="-3.6" class="fp-measure-text">${ft(W)}</text>
        <line x1="${W + 2.6}" y1="0" x2="${W + 2.6}" y2="${D}" class="fp-measure" marker-start="url(#fp-tick)" marker-end="url(#fp-tick)"/>
        <text x="${W + 3.8}" y="${D / 2}" class="fp-measure-text" transform="rotate(90 ${W + 3.8} ${D / 2})">${ft(D)}</text>
        <text x="${W / 2}" y="${D + 3.4}" class="fp-front">TOP EDGE (BALCONY SIDE) FACES ${DIR_NAMES[facing].toUpperCase()}</text>
        <g transform="translate(${-pad + 3} ${-top + 3}) rotate(${north})" class="fp-compass">
            <circle r="2.4"/>
            <path d="M0 -2 L0.9 0.6 L0 0.1 L-0.9 0.6 Z"/>
        </g>
        <text x="${-pad + 3 + Math.sin((north * Math.PI) / 180) * 3.6}" y="${-top + 3 - Math.cos((north * Math.PI) / 180) * 3.6 + 0.5}" class="fp-compass-label">N</text>
    </svg>`;
}
