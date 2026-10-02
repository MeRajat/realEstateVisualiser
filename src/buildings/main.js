// Apartment explorer — page shell, filters, detail sheet, lead capture.
// The three.js scene is dynamically imported so this bundle stays small.
import './buildings.css';
import {
    society, units, unitById, towers, stats, BUDGETS, FLOOR_BANDS, DEFAULT_FILTER, matches,
    formatMoney, formatRate, ordinal, DIR_NAMES, COMPASS8,
} from './model.js';
import { floorPlanSVG } from './floorplan.js';
import { track, trackVisit, submitLead } from '../customer/api.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEAD_KEY = 'gm_lead'; // shared with the plots site so a known visitor isn't asked twice
const CONTACT = {
    phone: import.meta.env.VITE_BUILDER_PHONE || '',
    whatsapp: import.meta.env.VITE_BUILDER_WHATSAPP || '',
};

const state = {
    filter: { ...DEFAULT_FILTER },
    unit: null,
    amenity: null,
    tab: 'overview',
    cutFloor: null,
    lead: readLead(),
    viewing: false,
    walking: false,
};
let scene = null;

function readLead() {
    try {
        const l = JSON.parse(localStorage.getItem(LEAD_KEY));
        return l && l.phone ? l : null;
    } catch { return null; }
}

// ─── HEADER ──────────────────────────────────────────
document.title = `${society.name} — 3D Apartment Explorer`;
$('society-name').textContent = society.name;
$('society-tagline').textContent = society.tagline;
$('stat-rate').textContent = formatRate(stats.minRate);

function updateCounts() {
    const shown = units.filter(u => u.status === 'Available' && matches(u, state.filter)).length;
    $('stat-available').textContent = shown;
}

// ─── QUICK CHIPS + FILTER DIALOG ─────────────────────
const bhkOptions = [...new Set(units.map(u => u.bhk))].sort().map(b => ({ id: String(b), label: `${b} BHK` }));
const FILTER_GROUPS = [
    { key: 'bhk', label: 'Configuration', options: bhkOptions },
    { key: 'status', label: 'Availability', options: [{ id: 'Available', label: 'Available only' }] },
    { key: 'budget', label: 'Budget', options: BUDGETS },
    { key: 'tower', label: 'Tower', options: towers.map(t => ({ id: t.id, label: t.name })) },
    { key: 'floors', label: 'Floor', options: FLOOR_BANDS },
    { key: 'facing', label: 'Facing', options: COMPASS8.filter(d => units.some(u => u.facing === d)).map(d => ({ id: d, label: DIR_NAMES[d] })) },
];

function renderChips() {
    const f = state.filter;
    const active = Object.keys(DEFAULT_FILTER).filter(k => f[k] !== DEFAULT_FILTER[k]).length;
    const quick = [
        ...bhkOptions.map(o => ({ key: 'bhk', ...o })),
        { key: 'status', id: 'Available', label: 'Available' },
        ...towers.map(t => ({ key: 'tower', id: t.id, label: t.name })),
    ];
    $('chips').innerHTML = `
        <button type="button" class="chip chip-filter" data-open-filters aria-haspopup="dialog">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Filters${active ? `<span class="badge">${active}</span>` : ''}
        </button>
        ${quick.map(q => `<button type="button" class="chip" data-key="${q.key}" data-id="${q.id}" aria-pressed="${f[q.key] === q.id}">${esc(q.label)}</button>`).join('')}`;
}

$('chips').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-open-filters')) return openFilters();
    const { key, id } = btn.dataset;
    applyFilter({ ...state.filter, [key]: state.filter[key] === id ? 'all' : id });
});

let draft = null;
function renderFilterGroups() {
    $('filter-groups').innerHTML = FILTER_GROUPS.map(g => `
        <fieldset>
            <legend>${g.label}</legend>
            <div class="pills">
                ${[{ id: 'all', label: 'Any' }, ...g.options].map(o =>
                    `<button type="button" class="pill" data-key="${g.key}" data-id="${o.id}" aria-pressed="${draft[g.key] === o.id}">${esc(o.label)}</button>`).join('')}
            </div>
        </fieldset>`).join('');
    const n = units.filter(u => matches(u, draft)).length;
    $('filters-apply').textContent = `Show ${n} home${n === 1 ? '' : 's'}`;
}

function openFilters() {
    draft = { ...state.filter };
    renderFilterGroups();
    $('filters-dialog').showModal();
}

$('filter-groups').addEventListener('click', e => {
    const b = e.target.closest('.pill');
    if (!b) return;
    draft[b.dataset.key] = b.dataset.id;
    renderFilterGroups();
});
$('filters-reset').addEventListener('click', () => { draft = { ...DEFAULT_FILTER }; renderFilterGroups(); });
$('filters-dialog').addEventListener('close', () => {
    if ($('filters-dialog').returnValue === 'apply') applyFilter(draft);
});

function applyFilter(f) {
    state.filter = { ...DEFAULT_FILTER, ...f };
    renderChips();
    updateCounts();
    scene?.setFilter(u => matches(u, state.filter));
}

// ─── FLOOR CUT-AWAY ──────────────────────────────────
const cut = $('floor-cut');
cut.min = stats.firstFloor;
cut.max = stats.maxFloor + 1; // top position = all floors
cut.value = cut.max;
function updateCut() {
    const v = Number(cut.value);
    state.cutFloor = v > stats.maxFloor ? null : v;
    $('floor-cut-value').textContent = state.cutFloor == null ? 'All' : ordinal(state.cutFloor);
    scene?.setCutFloor(state.cutFloor);
}
cut.addEventListener('input', updateCut);

// ─── SHEET ───────────────────────────────────────────
const sheet = $('sheet');
const sheetBody = $('sheet-body');

function openSheet(html) {
    sheetBody.innerHTML = html;
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    syncInsets();
}

function closeSheet() {
    sheet.classList.remove('is-open');
    sheet.hidden = true;
    syncInsets();
}

// Tell the 3D view which parts of the screen are covered by UI
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
function syncInsets() {
    if (!scene) return;
    if (state.viewing || (state.walking && sheet.hidden)) return scene.setInsets({});
    const top = $('legend').getBoundingClientRect().bottom;
    if (sheet.hidden) return scene.setInsets({ top: isMobile() ? top : 0 });
    if (isMobile()) scene.setInsets({ top, bottom: sheet.offsetHeight });
    else scene.setInsets({ right: window.innerWidth - sheet.offsetLeft });
}
window.addEventListener('resize', syncInsets);

sheet.querySelector('.sheet-close').addEventListener('click', () => {
    if (state.unit) selectUnit(null);
    else { state.amenity = null; closeSheet(); }
});

// Swipe the sheet down to dismiss (mobile)
let swipeY = null;
sheet.addEventListener('touchstart', e => {
    if (sheetBody.scrollTop <= 0) swipeY = e.touches[0].clientY;
}, { passive: true });
sheet.addEventListener('touchend', e => {
    if (swipeY != null && e.changedTouches[0].clientY - swipeY > 90) sheet.querySelector('.sheet-close').click();
    swipeY = null;
});

function similarUnits(u) {
    return units
        .filter(x => x !== u && x.status === 'Available' && x.typeId === u.typeId)
        .sort((a, b) => (a.tower !== u.tower) - (b.tower !== u.tower) || Math.abs(a.floor - u.floor) - Math.abs(b.floor - u.floor))
        .slice(0, 4);
}

function priceBlock(u) {
    const unlocked = !!state.lead;
    if (!unlocked) {
        return `<div class="price-card is-locked">
            <div class="price-row"><span>Rate</span><b class="blur">₹5,234 / sq.ft</b></div>
            <div class="price-row total"><span>Total price</span><b class="blur">₹88.6 L</b></div>
            <button type="button" class="btn-primary block" data-action="unlock">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                Unlock price for this home
            </button>
        </div>`;
    }
    const p = society.pricing;
    const lines = [
        `<li><span>Base rate</span><span>${formatRate(p.basePerSqft)}</span></li>`,
        u.rise ? `<li><span>Floor rise (${ordinal(u.floor)} floor)</span><span>+ ${formatRate(u.rise)}</span></li>` : '',
        ...u.premiums.map(x => `<li><span>${esc(x.label)} premium</span><span>${x.amount < 0 ? '− ' : '+ '}${formatRate(Math.abs(x.amount))}</span></li>`),
    ].join('');
    return `<div class="price-card">
        <div class="price-row"><span>Rate</span><b>${formatRate(u.rate)} <small>/ sq.ft</small></b></div>
        <ul class="breakdown">${lines}</ul>
        <div class="price-row total"><span>Total <small>(${u.type.superArea.toLocaleString('en-IN')} sq.ft × rate)</small></span><b>${formatMoney(u.total)}</b></div>
        <p class="fineprint">Indicative price excluding GST, registration and parking charges.</p>
    </div>`;
}

function unitSheet(u) {
    const sold = u.status !== 'Available';
    const tabs = `<div class="tabs" role="tablist">
        <button role="tab" class="tab" data-tab="overview" aria-selected="${state.tab === 'overview'}">Overview</button>
        <button role="tab" class="tab" data-tab="plan" aria-selected="${state.tab === 'plan'}">Floor plan</button>
    </div>`;
    const tags = [u.type.name, `${DIR_NAMES[u.facing]} facing`, ...u.tags.map(t => t.replace(/-/g, ' '))];
    const overview = `
        <div class="facts">
            <div><span>Carpet area</span><b>${u.type.carpet.toLocaleString('en-IN')} sq.ft</b></div>
            <div><span>Super area</span><b>${u.type.superArea.toLocaleString('en-IN')} sq.ft</b></div>
            <div><span>Floor</span><b>${ordinal(u.floor)} of ${u.tower.floors}</b></div>
            <div><span>Facing</span><b>${DIR_NAMES[u.facing]}</b></div>
        </div>
        ${priceBlock(u)}`;
    const plan = `<div class="plan-wrap">${floorPlanSVG(u.type, { facing: u.facing, bearing: u.bearing, title: u.id })}</div>
        <p class="fineprint">Indicative layout for ${esc(u.type.name)} · dimensions in feet. Actual unit may be mirrored.</p>`;
    const similar = sold ? similarUnits(u) : [];
    return `
        <div class="sheet-head">
            <span class="status-badge st-${u.status}">${u.status}</span>
            <span class="muted">${esc(u.tower.name)} · ${ordinal(u.floor)} floor</span>
        </div>
        <h2 class="sheet-title">Apartment ${esc(u.id)}</h2>
        <div class="tag-row">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        ${tabs}
        <div class="tab-panel">${state.tab === 'plan' ? plan : overview}</div>
        ${sold ? `<div class="notice">This apartment is ${u.status.toLowerCase()}.${similar.length ? ' Similar homes still available:' : ''}</div>
            <div class="similar">${similar.map(s => `<button type="button" class="similar-item" data-unit="${s.id}"><b>${s.id}</b><span>${ordinal(s.floor)} fl · ${DIR_NAMES[s.facing]}</span></button>`).join('')}</div>` : ''}
        <div class="sheet-actions">
            <button type="button" class="btn-secondary" data-action="view">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                Window view
            </button>
            <button type="button" class="btn-primary" data-action="enquire">${sold ? 'Get similar options' : 'Enquire / Site visit'}</button>
        </div>
        <button type="button" class="link-btn" data-action="share">Share this apartment</button>`;
}

function amenitySheet(a) {
    return `
        <div class="sheet-head"><span class="status-badge st-amenity">Amenity</span></div>
        <h2 class="sheet-title"><span class="amenity-icon" aria-hidden="true">${a.icon}</span> ${esc(a.name)}</h2>
        <p class="amenity-desc">${esc(a.description)}</p>
        <div class="facts">
            <div><span>Area</span><b>${(a.w * a.d).toLocaleString('en-IN')} sq.ft</b></div>
            ${a.timings ? `<div><span>Timings</span><b>${esc(a.timings)}</b></div>` : ''}
        </div>
        <button type="button" class="link-btn" data-action="amenities">← All amenities</button>`;
}

function amenitiesListSheet() {
    return `
        <h2 class="sheet-title">Amenities</h2>
        <p class="muted">Tap an amenity to fly to it.</p>
        <ul class="amenity-list">
            ${society.amenities.map(a => `<li><button type="button" data-amenity="${a.id}">
                <span class="amenity-icon" aria-hidden="true">${a.icon}</span>
                <span><b>${esc(a.name)}</b><small>${esc(a.description)}</small></span>
            </button></li>`).join('')}
        </ul>`;
}

sheetBody.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) {
        state.tab = t.dataset.tab;
        renderUnitSheet();
        return;
    }
    if (t.dataset.nearCat) return openSheet(nearbySheet(t.dataset.nearCat));
    if (t.dataset.unit) return selectUnit(unitById.get(t.dataset.unit));
    if (t.dataset.amenity) return selectAmenity(society.amenities.find(a => a.id === t.dataset.amenity));
    switch (t.dataset.action) {
        case 'unlock': return openLead({ unit: state.unit, reason: 'unlock' });
        case 'enquire': return enquire(state.unit);
        case 'view': return enterView(state.unit);
        case 'share': return share(state.unit);
        case 'amenities': return openSheet(amenitiesListSheet());
    }
});

function renderUnitSheet() {
    if (state.unit) openSheet(unitSheet(state.unit));
}

// ─── SELECTION ───────────────────────────────────────
let lastTracked = null;
function selectUnit(u, { focus = true } = {}) {
    state.unit = u;
    state.amenity = null;
    if (u) {
        state.tab = state.tab || 'overview';
        // Make sure the floor isn't sliced away
        if (state.cutFloor != null && u.floor > state.cutFloor) {
            cut.value = u.floor;
            updateCut();
        }
        if (!state.viewing) renderUnitSheet();
        if (lastTracked !== u.id) {
            lastTracked = u.id;
            track('plot_view', { plotId: u.id });
        }
        history.replaceState(null, '', `?unit=${encodeURIComponent(u.id)}`);
    } else {
        closeSheet();
        history.replaceState(null, '', location.pathname);
    }
    scene?.selectUnit(u, { focus });
    if (state.viewing && u) updateViewbar(u);
}

function selectAmenity(a) {
    state.amenity = a;
    state.unit = null;
    scene?.selectUnit(null, { focus: false });
    openSheet(amenitySheet(a));
    scene?.focusAmenity(a);
    history.replaceState(null, '', location.pathname);
}

$('amenities-btn').addEventListener('click', () => {
    if (state.viewing) exitView();
    if (state.walking) exitWalk();
    state.unit = null;
    scene?.selectUnit(null, { focus: false });
    openSheet(amenitiesListSheet());
});

// ─── VIEW FROM APARTMENT ─────────────────────────────
function updateViewbar(u) {
    $('viewbar-title').textContent = `Apartment ${u.id}`;
    $('viewbar-sub').textContent = `${ordinal(u.floor)} floor · faces ${DIR_NAMES[u.facing]}`;
    const sib = (d) => unitById.get(`${u.tower.id}-${u.floor + d}${String(u.pos).padStart(2, '0')}`);
    $('view-up').disabled = !sib(1);
    $('view-down').disabled = !sib(-1);
}

function enterView(u) {
    if (!scene || !u) return;
    if (state.walking) leaveWalkUi();
    state.viewing = true;
    document.body.classList.add('is-viewing');
    closeSheet();
    $('viewbar').hidden = false;
    $('view-hint').hidden = false;
    setTimeout(() => { $('view-hint').hidden = true; }, 4000);
    updateViewbar(u);
    if (state.cutFloor != null) { cut.value = cut.max; updateCut(); }
    scene.enterUnitView(u);
    syncInsets();
    track('view_mode', { mode: 'unit-view' });
}

function exitView() {
    if (!state.viewing) return;
    state.viewing = false;
    document.body.classList.remove('is-viewing');
    $('viewbar').hidden = true;
    $('view-hint').hidden = true;
    scene?.exitUnitView();
    if (state.unit) renderUnitSheet();
    else syncInsets();
}

$('view-exit').addEventListener('click', exitView);
['up', 'down'].forEach(dir => $(`view-${dir}`).addEventListener('click', () => {
    const u = state.unit;
    if (!u) return;
    const next = unitById.get(`${u.tower.id}-${u.floor + (dir === 'up' ? 1 : -1)}${String(u.pos).padStart(2, '0')}`);
    if (next) selectUnit(next);
}));

// ─── LEAD CAPTURE ────────────────────────────────────
const leadDialog = $('lead-dialog');
const leadForm = $('lead-form');
let leadContext = null;

function openLead({ unit = null, reason = 'unlock' } = {}) {
    leadContext = { unit, reason };
    $('lead-title').textContent = reason === 'unlock' ? 'Unlock price & details' : 'Talk to our sales team';
    $('lead-sub').textContent = reason === 'unlock'
        ? 'Share your number to see the exact price of every apartment and get a call back from our team.'
        : 'Leave your number and we’ll call you back with prices, offers and a site-visit slot.';
    $('lead-unit-field').hidden = !unit;
    leadForm.unit.value = unit ? `Apartment ${unit.id} · ${unit.type.name}` : '';
    if (state.lead) {
        leadForm.name.value = state.lead.name || '';
        leadForm.phone.value = state.lead.phone || '';
    }
    $('lead-error').hidden = true;
    leadDialog.showModal();
    setTimeout(() => (leadForm.name.value ? leadForm.phone : leadForm.name).focus(), 50);
}

leadDialog.querySelector('[data-close]').addEventListener('click', () => leadDialog.close());
leadDialog.addEventListener('click', e => { if (e.target === leadDialog) leadDialog.close(); });

leadForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = leadForm.name.value.trim();
    const phone = leadForm.phone.value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    const err = $('lead-error');
    if (name.length < 2) { err.textContent = 'Please enter your name.'; err.hidden = false; return; }
    if (!/^[6-9]\d{9}$/.test(phone)) { err.textContent = 'Please enter a valid 10-digit mobile number.'; err.hidden = false; return; }
    const btn = $('lead-submit');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        await submitLead({ name, phone, plotId: leadContext?.unit?.id ?? null });
        state.lead = { name, phone };
        try { localStorage.setItem(LEAD_KEY, JSON.stringify(state.lead)); } catch { /* private mode */ }
        leadDialog.close();
        toast(leadContext?.reason === 'unlock' ? 'Prices unlocked — thank you!' : `Thanks ${name.split(' ')[0]}! We'll call you shortly.`);
        renderUnitSheet();
    } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Continue';
    }
});

async function enquire(u) {
    if (!state.lead) return openLead({ unit: u, reason: 'enquire' });
    track('enquire', { plotId: u?.id ?? null });
    try {
        await submitLead({ ...state.lead, plotId: u?.id ?? null });
    } catch { /* still show contact options */ }
    const actions = [
        CONTACT.phone && `<a class="btn-secondary" href="tel:+${CONTACT.phone}">Call now</a>`,
        CONTACT.whatsapp && `<a class="btn-primary" target="_blank" rel="noopener" href="https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(`Hi, I'm interested in ${u ? `apartment ${u.id} at ` : ''}${society.name}.`)}">WhatsApp</a>`,
    ].filter(Boolean).join('');
    toast(`Thanks ${state.lead.name.split(' ')[0]}! Our team will call you on +91 ${state.lead.phone}.`, actions);
}

$('enquire-btn').addEventListener('click', () => enquire(state.unit));

async function share(u) {
    const url = `${location.origin}${location.pathname}?unit=${encodeURIComponent(u.id)}`;
    const text = `${u.type.name} apartment ${u.id} at ${society.name}`;
    try {
        if (navigator.share) await navigator.share({ title: society.name, text, url });
        else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch { /* user cancelled */ }
}

// ─── TOAST ───────────────────────────────────────────
let toastTimer = 0;
function toast(msg, actionsHtml = '') {
    const el = $('toast');
    el.innerHTML = `<span>${esc(msg)}</span>${actionsHtml ? `<div class="toast-actions">${actionsHtml}</div>` : ''}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, actionsHtml ? 8000 : 3500);
}

// ─── VIEW CONTROLS ───────────────────────────────────
$('side-controls').addEventListener('click', e => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (!scene || !a) return;
    if (a === 'zoom-in') scene.zoom(0.65);
    if (a === 'zoom-out') scene.zoom(1.5);
    if (a === 'reset') {
        if (state.viewing) return exitView();
        if (state.walking) return exitWalk();
        scene.reset();
    }
    if (a === 'time') cycleTime();
});

// ─── TIME OF DAY ─────────────────────────────────────
const TIME_ORDER = ['morning', 'noon', 'evening'];
const TIME_LABEL = { morning: 'Morning · sunrise in the east', noon: 'Noon', evening: 'Evening · sunset in the west' };
function cycleTime() {
    if (!scene) return;
    const next = TIME_ORDER[(TIME_ORDER.indexOf(scene.time) + 1) % TIME_ORDER.length];
    scene.setTime(next);
    $('time-btn').setAttribute('aria-label', `Time of day: ${next}. Tap to change`);
    $('time-btn').dataset.time = next;
    toast(TIME_LABEL[next]);
}

// ─── WALK AROUND ─────────────────────────────────────
function enterWalk() {
    if (!scene) return;
    if (state.viewing) exitView();
    state.walking = true;
    document.body.classList.add('is-walking');
    closeSheet();
    state.unit = null;
    scene.selectUnit(null, { focus: false });
    $('walkbar').hidden = false;
    $('walk-pad').hidden = false;
    if (state.cutFloor != null) { cut.value = cut.max; updateCut(); }
    scene.enterWalk();
    syncInsets();
    track('view_mode', { mode: 'walk' });
}

function leaveWalkUi() {
    state.walking = false;
    document.body.classList.remove('is-walking');
    $('walkbar').hidden = true;
    $('walk-pad').hidden = true;
}

function exitWalk() {
    if (!state.walking) return;
    leaveWalkUi();
    closeSheet();
    scene?.exitWalk();
    syncInsets();
}

$('walk-btn').addEventListener('click', enterWalk);
$('walk-exit').addEventListener('click', exitWalk);
$('walk-fwd').addEventListener('click', () => scene?.step(1));
$('walk-back').addEventListener('click', () => scene?.step(-1));

// ─── NEARBY (optional data: src/shared/nearby.json) ──
const nearbyLoader = Object.values(import.meta.glob('../shared/nearby.json'))[0];
let nearby = null;
const bearingTo = ([lat, lng]) => {
    const o = society.location;
    const dE = (lng - o.lng) * 111320 * Math.cos((o.lat * Math.PI) / 180);
    const dN = (lat - o.lat) * 110850;
    const deg = (Math.atan2(dE, dN) * 180) / Math.PI;
    return { km: Math.hypot(dE, dN) / 1000, dir: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg + 360) % 360) / 45) % 8] };
};
function nearbySheet(cat = 'all') {
    const cats = nearby.categories || [];
    const places = (nearby.places || []).filter(p => cat === 'all' || p.cat === cat)
        .map(p => ({ ...p, ...bearingTo(p.pos) }))
        .sort((a, b) => (a.driveMin ?? a.km * 3) - (b.driveMin ?? b.km * 3));
    const roads = cat === 'all' ? (nearby.roads || []) : [];
    const gateRoad = society.approach?.joins;
    const gateM = Math.round((society.approach?.length || 0) * 0.3048);
    const row = (p) => p.name === gateRoad
        ? `<li><div><b>${esc(p.name)}</b><small>${esc(p.type || '')}</small></div>
            <div class="near-dist"><b>At the gate</b><small>${gateM} m private approach road</small></div></li>`
        : `<li><div><b>${esc(p.name)}</b><small>${esc(p.kind || p.type || '')}</small></div>
        <div class="near-dist"><b>${p.driveMin != null ? `${Math.round(p.driveMin)} min` : `${p.km.toFixed(1)} km`}</b>
        <small>${p.driveKm != null ? `${(+p.driveKm).toFixed(1)} km drive` : ''} · ${p.dir}</small></div></li>`;
    return `
        <h2 class="sheet-title">Nearby</h2>
        <p class="muted">${esc(`Gate opens onto ${society.approach?.joins || 'the main road'}.`)} Drive times are approximate.</p>
        <div class="pills near-cats">
            ${[{ id: 'all', label: 'All' }, ...cats].map(c => `<button type="button" class="pill" data-near-cat="${esc(c.id)}" aria-pressed="${c.id === cat}">${esc(c.label)}</button>`).join('')}
        </div>
        ${roads.length ? `<h3 class="near-h">Road connectivity</h3><ul class="near-list">${roads.map(r => row({ ...r, ...bearingTo(r.pos) })).join('')}</ul>` : ''}
        <h3 class="near-h">${cat === 'all' ? 'Places' : esc(cats.find(c => c.id === cat)?.label || '')}</h3>
        <ul class="near-list">${places.map(row).join('') || '<li class="muted">Nothing listed yet.</li>'}</ul>`;
}
if (nearbyLoader) {
    nearbyLoader().then(m => {
        nearby = m.default || m;
        if (nearby?.places?.length) $('nearby-btn').hidden = false;
    }).catch(() => {});
}
$('nearby-btn').addEventListener('click', () => {
    if (!nearby) return;
    if (state.viewing) exitView();
    if (state.walking) exitWalk();
    state.unit = null;
    state.amenity = null;
    scene?.selectUnit(null, { focus: false });
    openSheet(nearbySheet());
});

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!sheet.hidden) sheet.querySelector('.sheet-close').click();
    else if (state.viewing) exitView();
    else if (state.walking) exitWalk();
});

// ─── BOOT ────────────────────────────────────────────
const rose = $('compass-rose');
renderChips();
updateCounts();
trackVisit();

async function boot() {
    // Let fonts settle so 3D labels use Outfit, but never block for long
    await Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 1200))]);
    const { createScene } = await import('./scene.js');
    scene = createScene($('scene'), {
        onUnit: (u) => selectUnit(u, { focus: true }),
        onAmenity: (a) => selectAmenity(a),
        onEmpty: () => { if (state.unit) selectUnit(null); },
        onViewChange: () => {},
        onHeading: (deg) => { rose.style.transform = `rotate(${-deg}deg)`; },
    });
    $('scene-loading').classList.add('is-done');
    setTimeout(() => $('scene-loading').remove(), 600);
    scene.setFilter(u => matches(u, state.filter));
    syncInsets();
    const initial = unitById.get(new URLSearchParams(location.search).get('unit'));
    if (initial) setTimeout(() => selectUnit(initial), 1700); // after the intro swing
}

boot().catch(err => {
    console.error(err);
    $('scene-loading').innerHTML = '<span>3D view could not load on this device. Try a newer browser.</span>';
});
