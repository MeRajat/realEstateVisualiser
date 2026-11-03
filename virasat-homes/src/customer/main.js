// Virasat Homes customer site: satellite map + plan + brochure, live availability, plot details, enquiry.
import './styles.css';
import { createMap } from './map.js';
import { createPlanView } from '../shared/planview.js';
import { toLatLng } from '../shared/geo.js';
import { plots, plotById, project, STATUS, STATUS_ORDER, SIZE_BUCKETS, fmtNum, fmtMoney, facingText, priceOf, findPlot } from '../shared/plots.js';
import broUrl from '../../assets/layout-plan.webp';
import gateUrl from '../../assets/gate.webp';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const API = '/api/virasat';
const PHONE = (import.meta.env.VITE_VIRASAT_PHONE || '').replace(/\D/g, '');
const WHATSAPP = (import.meta.env.VITE_VIRASAT_WHATSAPP || PHONE).replace(/\D/g, '');

// ─── visitor id + tracking (anonymous) ──────────────
function store(kind) { try { return window[kind]; } catch { return null; } }
function visitorId() {
    const ls = store('localStorage');
    let id = null;
    try { id = ls?.getItem('vh_vid'); } catch { /* blocked */ }
    if (!id) {
        id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9-]/g, '');
        try { ls?.setItem('vh_vid', id); } catch { /* private mode */ }
    }
    return id;
}
const VID = visitorId();
const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
const track = (type, extra = {}) => post('/track', { visitorId: VID, type, ...extra }).catch(() => {});
(function trackVisit() {
    const ss = store('sessionStorage');
    try { if (ss?.getItem('vh_visit')) return; ss?.setItem('vh_visit', '1'); } catch { /* ignore */ }
    const u = new URLSearchParams(location.search);
    track('visit', { referrer: document.referrer || null, utmSource: u.get('utm_source') });
})();

// ─── state ─────────────────────────────────────────
const state = { view: 'map', selected: null, statuses: new Set(), sizes: new Set(), facing: new Set() };
const matches = (p) =>
    (!state.statuses.size || state.statuses.has(p.status)) &&
    (!state.sizes.size || SIZE_BUCKETS.some(b => state.sizes.has(b.id) && b.test(p.areaSqYd))) &&
    (!state.facing.size || p.facing.some(f => state.facing.has(f.dir.split('-')[0])));
const anyFilter = () => state.statuses.size || state.sizes.size || state.facing.size;

// ─── views ─────────────────────────────────────────
const sheet = $('#sheet');
function overlayPadding() {
    const desktop = window.matchMedia('(min-width: 900px)').matches;
    const sheetOpen = !sheet.hidden;
    return {
        top: 24,
        left: 24,
        right: desktop && sheetOpen ? sheet.offsetWidth + 40 : 64,
        bottom: !desktop && sheetOpen ? Math.min(sheet.offsetHeight, window.innerHeight * 0.55) + 24 : 72,
    };
}
const mapView = createMap($('#map'), {
    fillOf: ({ id }) => { const p = plotById.get(id); return { color: STATUS[p.status].color, dim: anyFilter() && !matches(p) }; },
    onSelect: (id) => selectPlot(id),
    padding: overlayPadding,
});
const planView = createPlanView($('#plan'), {
    fillOf: ({ id }) => { const p = plotById.get(id); return anyFilter() && !matches(p) ? '#dadce0' : STATUS[p.status].color; },
    onSelect: (id) => selectPlot(id),
    padding: overlayPadding,
});

function refresh() { mapView.update(); planView.update(); renderFilters(); }

function setView(v) {
    state.view = v;
    document.querySelectorAll('.seg [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    ['map', 'plan', 'brochure'].forEach(id => { $('#' + id).hidden = id !== v; });
    document.body.dataset.view = v;
    if (v === 'map') mapView.show();
    if (v === 'brochure' && !$('#broImg').src) $('#broImg').src = broUrl;
    if (state.selected && v !== 'brochure') focusSelected();
}
document.querySelectorAll('.seg [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ─── filters & legend ──────────────────────────────
function renderFilters() {
    const count = Object.fromEntries(STATUS_ORDER.map(s => [s, 0]));
    plots.forEach(p => { count[p.status]++; });
    const chips = STATUS_ORDER.filter(s => count[s] || s === 'available').map(s =>
        `<button type="button" class="chip${state.statuses.has(s) ? ' on' : ''}" data-f="status" data-v="${s}"><i style="background:${STATUS[s].color}"></i>${STATUS[s].label} <b>${count[s]}</b></button>`).join('');
    const sizes = SIZE_BUCKETS.map(b => `<button type="button" class="chip${state.sizes.has(b.id) ? ' on' : ''}" data-f="size" data-v="${b.id}">${b.label}</button>`).join('');
    const facing = ['North', 'East', 'South', 'West'].map(d => `<button type="button" class="chip${state.facing.has(d) ? ' on' : ''}" data-f="facing" data-v="${d}">${d} facing</button>`).join('');
    const n = plots.filter(matches).length;
    $('#filters').innerHTML = chips + '<span class="sep"></span>' + sizes + '<span class="sep"></span>' + facing +
        (anyFilter() ? `<button type="button" class="chip clear" data-f="clear">Clear · ${n} match</button>` : '');
}
$('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const set = { status: state.statuses, size: state.sizes, facing: state.facing }[b.dataset.f];
    if (b.dataset.f === 'clear') { state.statuses.clear(); state.sizes.clear(); state.facing.clear(); }
    else if (set.has(b.dataset.v)) set.delete(b.dataset.v);
    else set.add(b.dataset.v);
    refresh();
});
$('#legend').innerHTML = STATUS_ORDER.slice(0, 4).map(s => `<span><i style="background:${STATUS[s].color}"></i>${STATUS[s].label}</span>`).join('') +
    '<span><i style="background:#cfe8c6"></i>Park / green</span>';

// ─── selection + details sheet ─────────────────────
function focusSelected() {
    if (!state.selected) return;
    requestAnimationFrame(() => (state.view === 'plan' ? planView.focus(state.selected) : mapView.focus(state.selected)));
}

function openSheet(html) {
    $('#sheetBody').innerHTML = html;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    document.body.classList.add('sheet-open');
}
function closeSheet() {
    sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    if (state.selected) selectPlot(null);
}
sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

function plotHtml(p) {
    const st = STATUS[p.status];
    const price = priceOf(p);
    const canBuy = p.status === 'available' || p.status === 'hold';
    const [lat, lng] = toLatLng(p.center);
    return `
      <div class="pd-head">
        <h2>Plot ${esc(p.id)}</h2>
        <span class="pill" style="--c:${st.color}">${st.label}</span>
      </div>
      <dl class="pd-grid">
        <div><dt>Area</dt><dd>${fmtNum(p.areaSqYd, 2)} sq yd<small>${fmtNum(p.areaSqFt)} sq ft${p.areaSource === 'measured' ? ' · measured from plan' : ''}</small></dd></div>
        <div><dt>Size</dt><dd>${p.dims ? esc(p.dims.label) : 'Irregular shape'}<small>${esc(p.category)} plot</small></dd></div>
        <div class="wide"><dt>Faces</dt><dd>${esc(facingText(p))}</dd></div>
        <div class="wide"><dt>Price</dt><dd>${price ? `${fmtMoney(price.total)}<small>₹${fmtNum(price.perSqYd)} per sq yd</small>` : 'Price on request'}</dd></div>
      </dl>
      ${canBuy ? `
      <form class="lead" id="leadForm" novalidate>
        <h3>${p.status === 'hold' ? 'On hold right now. Ask to be next in line' : 'Get price & site visit'}</h3>
        <input name="name" autocomplete="name" placeholder="Your name" required maxlength="60">
        <input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="Mobile number (10 digits)" required maxlength="14">
        <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="btn-primary" type="submit">Request a call back</button>
        <p class="fine">We only use your number to call you about this project.</p>
      </form>` : `<p class="note">This plot is ${st.label.toLowerCase()}. Tap a green plot to see one that is available.</p>`}
      <div class="pd-actions">
        <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}" target="_blank" rel="noopener" data-track="directions">Directions</a>
        <button class="btn" type="button" data-share>Share</button>
        ${WHATSAPP ? `<a class="btn" href="https://wa.me/91${WHATSAPP}?text=${encodeURIComponent(`Hi, I am interested in Plot ${p.id} at Virasat Homes.`)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${PHONE ? `<a class="btn" href="tel:+91${PHONE}">Call</a>` : ''}
      </div>`;
}

function selectPlot(id, { focus = true } = {}) {
    const p = id ? plotById.get(id) : null;
    state.selected = p ? p.id : null;
    mapView.select(state.selected);
    planView.select(state.selected);
    const hash = p ? '#plot=' + encodeURIComponent(p.id) : ' ';
    history.replaceState(null, '', hash === ' ' ? location.pathname + location.search : hash);
    if (!p) {
        if (!sheet.hidden && $('#sheetBody .pd-head')) { sheet.hidden = true; document.body.classList.remove('sheet-open'); }
        return;
    }
    openSheet(plotHtml(p));
    wirePlotSheet(p);
    track('plot_view', { plotId: p.id });
    if (focus) focusSelected();
}

function wirePlotSheet(p) {
    $('#sheetBody [data-track="directions"]')?.addEventListener('click', () => track('directions', { plotId: p.id }));
    $('#sheetBody [data-share]')?.addEventListener('click', async () => {
        const url = location.origin + location.pathname + '#plot=' + encodeURIComponent(p.id);
        const text = `Plot ${p.id} at Virasat Homes · ${fmtNum(p.areaSqYd, 2)} sq yd`;
        try {
            if (navigator.share) await navigator.share({ title: 'Virasat Homes', text, url });
            else { await navigator.clipboard.writeText(url); toast('Link copied'); }
        } catch { /* cancelled */ }
    });
    const form = $('#leadForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const btn = form.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
            const r = await post('/lead', { visitorId: VID, plotId: p.id, name: fd.get('name'), phone: fd.get('phone'), website: fd.get('website') });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || 'Could not send. Please try again.');
            form.outerHTML = `<div class="done"><b>Thank you, ${esc(fd.get('name'))}.</b><p>Our team will call you soon about Plot ${esc(p.id)}.</p></div>`;
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Request a call back';
            toast(err.message);
        }
    });
}

// ─── project info ──────────────────────────────────
function infoHtml() {
    const avail = plots.filter(p => p.status === 'available').length;
    return `
      <img class="hero" src="${gateUrl}" alt="Entrance gate of Virasat Homes" loading="lazy">
      <h2>${esc(project.name)}</h2>
      <p class="muted">${esc(project.address)}</p>
      <div class="facts">
        <div><b>${plots.length}</b><span>plots</span></div>
        <div><b>${avail}</b><span>available</span></div>
        <div><b>15.5</b><span>acres</span></div>
      </div>
      <p class="rera">RERA: <b>${esc(project.rera)}</b> · <a href="https://rera.rajasthan.gov.in/" target="_blank" rel="noopener">rera.rajasthan.gov.in</a></p>
      <h3>Amenities</h3>
      <ul class="tags">${project.amenities.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      <h3>Distances</h3>
      <ul class="dist">${project.distances.map(([n, km]) => `<li><span>${esc(n)}</span><b>${km} km</b></li>`).join('')}</ul>
      <h3>Developer</h3>
      <p>${esc(project.developer)}<br><span class="muted">${esc(project.office)}</span><br><span class="muted">Promoter RERA ${esc(project.promoterRera)}</span></p>
      <p class="fine">${esc(project.source)} Map placement is matched to the satellite photo and Kotkhawada Road; the developer's demarcation on site is final.</p>`;
}
$('#infoBtn').addEventListener('click', () => { if (state.selected) selectPlot(null); openSheet(infoHtml()); });

// ─── search, buttons, toast ────────────────────────
$('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = findPlot($('#q').value);
    if (!p) return toast('No plot with that number. Try 25, L3 or E12.');
    $('#q').blur();
    if (state.view === 'brochure') setView('map');
    selectPlot(p.id);
});
$('#fabs').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const v = state.view === 'plan' ? planView : state.view === 'map' ? mapView : null;
    if (act === 'in') v ? v.zoomIn() : broZoom(1.5);
    if (act === 'out') v ? v.zoomOut() : broZoom(1 / 1.5);
    if (act === 'fit') v ? (state.view === 'plan' ? planView.reset() : mapView.fit()) : broZoom(0);
    if (act === 'me') {
        try {
            const d = await mapView.locate();
            toast(`You are ${d > 1000 ? fmtNum(d / 1000, 1) + ' km' : Math.round(d) + ' m'} from Virasat Homes`);
        } catch { toast('Could not get your location'); }
    }
});
$('#opacity').addEventListener('input', (e) => mapView.setOpacity(e.target.value / 100));

let broScale = 1;
function broZoom(f) {
    broScale = f === 0 ? 1 : Math.min(5, Math.max(1, broScale * f));
    $('#broImg').style.width = broScale * 100 + '%';
}

let toastTimer;
function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

// ─── live availability ─────────────────────────────
async function loadInventory() {
    try {
        const r = await fetch(API + '/inventory');
        if (!r.ok) return;
        const { plots: rows } = await r.json();
        const sel = state.selected && plotById.get(state.selected);
        const before = sel ? sel.status + '|' + sel.pricePerSqYd : '';
        for (const row of rows) {
            const p = plotById.get(row.id);
            if (p) { p.status = STATUS[row.status] ? row.status : 'available'; p.pricePerSqYd = row.pricePerSqYd; }
        }
        refresh();
        // only redraw an open plot card when that plot actually changed
        if (sel && before !== sel.status + '|' + sel.pricePerSqYd && $('#sheetBody .pd-head')) {
            const p = plotById.get(state.selected);
            openSheet(plotHtml(p));
            wirePlotSheet(p);
        }
    } catch { /* offline: keep last known */ }
}

// ─── start ─────────────────────────────────────────
refresh();
setView('map');
loadInventory().then(() => {
    const m = /plot=([^&]+)/.exec(location.hash);
    if (m && plotById.has(decodeURIComponent(m[1]))) selectPlot(decodeURIComponent(m[1]));
});
setInterval(() => { if (document.visibilityState === 'visible') loadInventory(); }, 60000);
window.addEventListener('resize', () => { if (state.view === 'map') mapView.map.invalidateSize(); });
