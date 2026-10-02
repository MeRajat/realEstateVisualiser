// Plot detail sheet content (bottom sheet on mobile, side panel on desktop).
import { plots, formatPrice, ZONES } from '../shared/site.js';
import { SIZE_BUCKETS } from './store.js';

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => n.toLocaleString('en-IN');

function pricePerSqFt(p) {
    if (!p.priceLakh || !p.areaSqFt) return null;
    return Math.round((p.priceLakh * 100000) / p.areaSqFt);
}

// Nearest available plots of a similar size — offered when a plot is sold
export function similarPlots(plot, n = 3) {
    const bucket = SIZE_BUCKETS.find(b => b.test(plot.areaSqFt));
    return plots
        .filter(p => p.status === 'Available' && p.id !== plot.id && (!bucket || bucket.test(p.areaSqFt)))
        .map(p => ({ p, d: Math.hypot(p.center[0] - plot.center[0], p.center[1] - plot.center[1]) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, n)
        .map(x => x.p);
}

function diagram(p) {
    if (!p.dims) return '';
    const { w, h } = p.dims;
    const dirs = new Map(p.facing.map(f => [f.dir, f.road]));
    const maxW = 200, maxH = 120;
    const k = Math.min(maxW / w, maxH / h);
    const rW = Math.max(80, w * k), rH = Math.max(50, h * k);
    const pL = 44, pT = 34, pR = 44, pB = 30;
    const W = rW + pL + pR, H = rH + pT + pB;
    const road = (dir) => {
        if (!dirs.has(dir)) return '';
        const name = esc(dirs.get(dir));
        if (dir === 'North') return `<rect x="${pL}" y="4" width="${rW}" height="14" rx="3" class="dg-road"/><text x="${pL + rW / 2}" y="11" class="dg-road-t">${name}</text>`;
        if (dir === 'South') return `<rect x="${pL}" y="${pT + rH + 12}" width="${rW}" height="14" rx="3" class="dg-road"/><text x="${pL + rW / 2}" y="${pT + rH + 19}" class="dg-road-t">${name}</text>`;
        const x = dir === 'West' ? 4 : pL + rW + 26;
        return `<rect x="${x}" y="${pT}" width="14" height="${rH}" rx="3" class="dg-road"/><text x="${x + 7}" y="${pT + rH / 2}" class="dg-road-t" transform="rotate(-90 ${x + 7} ${pT + rH / 2})">${name}</text>`;
    };
    return `<svg viewBox="0 0 ${W} ${H}" class="plot-diagram" role="img" aria-label="Plot ${esc(p.id)}: ${w} by ${h} feet">
        ${road('North')}${road('South')}${road('West')}${road('East')}
        <rect x="${pL}" y="${pT}" width="${rW}" height="${rH}" rx="3" class="dg-plot"/>
        <line x1="${pL}" y1="${pT - 8}" x2="${pL + rW}" y2="${pT - 8}" class="dg-dim"/>
        <text x="${pL + rW / 2}" y="${pT - 11}" class="dg-dim-t">${w} ft</text>
        <line x1="${pL - 8}" y1="${pT}" x2="${pL - 8}" y2="${pT + rH}" class="dg-dim"/>
        <text x="${pL - 11}" y="${pT + rH / 2}" class="dg-dim-t" transform="rotate(-90 ${pL - 11} ${pT + rH / 2})">${h} ft</text>
        <text x="${pL + rW / 2}" y="${pT + rH / 2}" class="dg-id">${esc(p.id)}</text>
        <text x="${pL + rW - 8}" y="${pT + 14}" class="dg-north">N ↑</text>
    </svg>`;
}

export function renderSheet(p, { unlocked }) {
    const zone = ZONES.find(z => z.id === p.zone);
    const facing = p.facing.length ? p.facing.map(f => f.dir).join(' & ') : '—';
    const ppsf = pricePerSqFt(p);
    const sold = p.status !== 'Available';

    const head = `
        <div class="sheet-head">
            <div class="pills-row">
                <span class="status-pill st-${esc(p.status)}">${esc(p.status)}</span>
                ${zone ? `<span class="zone-pill" style="--zc:${zone.color}">${zone.name}</span>` : ''}
                ${p.facing.length > 1 ? '<span class="zone-pill corner">Corner plot</span>' : ''}
            </div>
            <h2>Plot ${esc(p.id)}</h2>
        </div>
        <div class="facts">
            <div><span>Area</span><b>${fmt(p.areaSqFt)} <small>sq.ft</small></b></div>
            <div><span>In Gaj</span><b>${p.gaj}</b></div>
            <div><span>Facing</span><b>${facing}</b></div>
        </div>`;

    const details = unlocked
        ? `<div class="price-card">
                <div><span>Price</span><b>${esc(formatPrice(p))}</b></div>
                ${ppsf ? `<div><span>Rate</span><b>₹${fmt(ppsf)}<small>/sq.ft</small></b></div>` : ''}
                ${p.dims ? `<div><span>Size</span><b>${p.dims.w} × ${p.dims.h}<small> ft</small></b></div>` : ''}
           </div>
           ${diagram(p)}`
        : `<div class="locked">
                <div class="locked-preview" aria-hidden="true">
                    <div><span>Price</span><b>₹ •• Lakhs</b></div>
                    <div><span>Rate</span><b>₹ •,••• /sq.ft</b></div>
                    <div><span>Size</span><b>•• × •• ft</b></div>
                </div>
                <button type="button" class="btn-primary block" data-action="unlock">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                    See price, size &amp; layout
                </button>
           </div>`;

    const alternatives = sold
        ? `<div class="similar">
                <p>This plot is ${p.status.toLowerCase()}. Similar plots still available nearby:</p>
                <div class="similar-list">${similarPlots(p).map(s =>
                    `<button type="button" data-action="goto" data-id="${esc(s.id)}"><b>Plot ${esc(s.id)}</b><span>${fmt(s.areaSqFt)} sq.ft${s.facing[0] ? ' · ' + s.facing[0].dir : ''}</span></button>`
                ).join('')}</div>
           </div>`
        : '';

    const actions = `
        <div class="sheet-actions">
            ${sold ? '' : `<button type="button" class="btn-primary" data-action="enquire">Enquire about this plot</button>`}
            <a class="btn-ghost" data-action="directions" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 11 22 2l-9 19-2-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>Directions</a>
            <button type="button" class="btn-ghost" data-action="share">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="18" cy="5" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" stroke="currentColor" stroke-width="2"/></svg>Share</button>
        </div>`;

    // A sold plot's price isn't useful (and shouldn't be a reason to ask for a number)
    return head + alternatives + (sold ? '' : details) + actions;
}
