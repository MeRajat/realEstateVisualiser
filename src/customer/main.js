import './styles.css';
import { SITE, GEO, plots, plotById, stats, ZONES, toLatLng } from '../shared/site.js';
import {
    state, on, selectPlot, setFilter, setLead, setView, matchesFilter,
    activeFilterCount, SIZE_BUCKETS, DEFAULT_FILTER,
} from './store.js';
import { trackVisit, trackPlotView, track, submitLead } from './api.js';
import { createPlanView } from './plan.js';
import { renderSheet } from './sheet.js';
import { isMobile } from './layout.js';

const $ = (id) => document.getElementById(id);

// ─── STATIC CONTENT ──────────────────────────────────
$('site-name').textContent = SITE.name;
$('site-tagline').textContent = SITE.tagline;
$('stat-available').textContent = stats.available;
$('stat-sold').textContent = stats.sold;
$('stat-total').textContent = stats.total;

// ─── TOAST ───────────────────────────────────────────
let toastTimer;
function toast(html, ms = 3200) {
    const el = $('toast');
    el.innerHTML = html;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('is-visible');
        setTimeout(() => { el.hidden = true; }, 250);
    }, ms);
}

// ─── VIEWS (plan eager, 3D + map lazy) ───────────────
const compass = $('compass');
const views = { plan: createPlanView($('view-plan')) };
const loaders = {
    '3d': async () => {
        await document.fonts?.ready; // labels are drawn into a canvas texture
        const { create3DView } = await import('./view3d.js');
        return create3DView($('view-3d'), { compass });
    },
    map: async () => {
        const { createMapView } = await import('./mapview.js');
        return createMapView($('view-map'), { opacitySlider: $('opacity-slider') });
    },
};

let switching = 0;
async function showView(name) {
    if (name === state.view && views[name]) return;
    const ticket = ++switching;
    document.querySelectorAll('.seg').forEach(b => {
        const active = b.dataset.view === name;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${name}`));
    $('opacity-control').hidden = name !== 'map';
    compass.style.transform = name === 'map' ? '' : `rotate(${GEO.rotationDeg}deg)`;
    document.body.dataset.view = name;

    const prev = views[state.view];
    setView(name);
    prev?.hide?.();

    if (!views[name]) {
        $('view-loading').hidden = false;
        try {
            views[name] = await loaders[name]();
        } catch (err) {
            console.error(err);
            toast('Could not load this view. Please check your connection.');
            $('view-loading').hidden = true;
            return showView('plan');
        }
        $('view-loading').hidden = true;
    }
    if (ticket !== switching) return; // user moved on while loading
    views[name].show?.();
    track('view_mode', { mode: name });
}

document.querySelectorAll('.seg').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

$('view-controls').addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    const view = views[state.view];
    if (!view || !action) return;
    if (action === 'zoom-in') view.zoomIn();
    if (action === 'zoom-out') view.zoomOut();
    if (action === 'reset') view.reset();
});

// ─── DETAIL SHEET ────────────────────────────────────
const sheet = $('sheet');
const sheetBody = $('sheet-body');

function renderCurrentSheet() {
    const plot = plotById.get(state.selectedId);
    if (!plot) return;
    sheetBody.innerHTML = renderSheet(plot, { unlocked: !!state.lead });
    const [lat, lng] = toLatLng(plot.center);
    const dir = sheetBody.querySelector('[data-action="directions"]');
    if (dir) dir.href = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

on('select', ({ plot }) => {
    if (!plot) {
        sheet.classList.remove('is-open');
        setTimeout(() => { if (!state.selectedId) sheet.hidden = true; }, 260);
        history.replaceState(null, '', location.pathname + location.search);
        return;
    }
    renderCurrentSheet();
    sheet.hidden = false;
    sheet.style.transform = '';
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    sheetBody.scrollTop = 0;
    history.replaceState(null, '', `#plot-${encodeURIComponent(plot.id)}`);
    trackPlotView(plot.id);
});
on('lead', renderCurrentSheet);

sheet.querySelector('.sheet-close').addEventListener('click', () => selectPlot(null));
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedId && !document.querySelector('dialog[open]')) selectPlot(null);
});

sheetBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const plot = plotById.get(state.selectedId);
    switch (btn.dataset.action) {
        case 'unlock':
            openLead({ plotId: plot.id });
            break;
        case 'enquire':
            enquire(plot);
            break;
        case 'goto':
            selectPlot(btn.dataset.id, 'ui');
            break;
        case 'share':
            sharePlot(plot);
            break;
        case 'directions':
            track('enquire', { plotId: plot.id });
            break;
    }
});

async function sharePlot(plot) {
    const url = `${location.origin}${location.pathname}#plot-${encodeURIComponent(plot.id)}`;
    const text = `Plot ${plot.id} · ${plot.area} at ${SITE.name}`;
    try {
        if (navigator.share) await navigator.share({ title: SITE.name, text, url });
        else {
            await navigator.clipboard.writeText(url);
            toast('Link copied');
        }
    } catch { /* user cancelled */ }
}

// Swipe the mobile sheet down to dismiss
(() => {
    let startY = null;
    let dy = 0;
    const grip = sheet.querySelector('.sheet-grip');
    const begin = (e) => {
        if (!isMobile()) return;
        if (e.target !== grip && sheetBody.scrollTop > 0) return;
        startY = e.touches[0].clientY;
        dy = 0;
        sheet.style.transition = 'none';
    };
    const move = (e) => {
        if (startY == null) return;
        dy = Math.max(0, e.touches[0].clientY - startY);
        if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
        if (startY == null) return;
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (dy > 90) selectPlot(null);
        startY = null;
    };
    sheet.addEventListener('touchstart', begin, { passive: true });
    sheet.addEventListener('touchmove', move, { passive: true });
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
})();

// ─── LEAD CAPTURE (soft gate) ────────────────────────
const leadDialog = $('lead-dialog');
const leadForm = $('lead-form');
let leadContext = null;

function openLead({ plotId = null, title, sub, submitLabel } = {}) {
    leadContext = { plotId };
    $('lead-title').textContent = title || 'See price & full details';
    $('lead-sub').textContent = sub || 'Share your number to unlock prices, plot sizes and layouts. Our team can also call you back with offers.';
    $('lead-submit').textContent = submitLabel || 'Continue';
    $('lead-plot-field').hidden = !plotId;
    leadForm.plotId.value = plotId ? `Plot ${plotId}` : '';
    $('lead-error').hidden = true;
    if (state.lead) {
        leadForm.name.value = state.lead.name;
        leadForm.phone.value = state.lead.phone;
    }
    leadDialog.showModal();
    setTimeout(() => (leadForm.name.value ? leadForm.phone : leadForm.name).focus(), 50);
}

leadDialog.querySelector('[data-close]').addEventListener('click', () => leadDialog.close());
leadDialog.addEventListener('click', (e) => { if (e.target === leadDialog) leadDialog.close(); });

leadForm.phone.addEventListener('input', () => {
    leadForm.phone.value = leadForm.phone.value.replace(/[^\d ]/g, '');
});

leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = leadForm.name.value.trim();
    const phone = leadForm.phone.value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    const err = $('lead-error');
    const fail = (msg, field) => { err.textContent = msg; err.hidden = false; field?.focus(); };
    if (name.length < 2) return fail('Please enter your name.', leadForm.name);
    if (!/^[6-9]\d{9}$/.test(phone)) return fail('Please enter a valid 10-digit mobile number.', leadForm.phone);

    const btn = $('lead-submit');
    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
        await submitLead({ name, phone, plotId: leadContext?.plotId, website: leadForm.website.value });
        setLead({ name, phone });
        leadDialog.close();
        const first = name.split(' ')[0];
        toast(leadContext?.plotId
            ? `Thanks ${esc(first)}! Details unlocked. Our team will reach you on ${phone.slice(0, 5)} ${phone.slice(5)}.`
            : `Thanks ${esc(first)}! Our team will call you shortly.`);
    } catch (ex) {
        fail(ex.message);
    } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
    }
});

const esc = (s) => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function contactLinks(plot) {
    const msg = encodeURIComponent(`Hi, I'm interested in ${plot ? `Plot ${plot.id} (${plot.area})` : 'plots'} at ${SITE.name}.`);
    const links = [];
    if (SITE.phone) links.push(`<a href="tel:+${SITE.phone}">Call now</a>`);
    if (SITE.whatsapp) links.push(`<a href="https://wa.me/${SITE.whatsapp}?text=${msg}" target="_blank" rel="noopener">WhatsApp</a>`);
    return links.length ? `<span class="toast-links">${links.join('')}</span>` : '';
}

async function enquire(plot) {
    if (!state.lead) {
        openLead({
            plotId: plot?.id,
            title: plot ? `Enquire about Plot ${plot.id}` : 'Get a call back',
            sub: 'Leave your number and our sales team will call you with price, offers and a site visit slot.',
            submitLabel: 'Request call back',
        });
        return;
    }
    track('enquire', { plotId: plot?.id });
    submitLead({ ...state.lead, plotId: plot?.id }).catch(() => {});
    toast(`Thanks ${esc(state.lead.name.split(' ')[0])}! We'll call you about ${plot ? `Plot ${esc(plot.id)}` : 'available plots'} shortly.${contactLinks(plot)}`, 6000);
}

$('enquire-btn').addEventListener('click', () => enquire(plotById.get(state.selectedId)));

// ─── SEARCH ──────────────────────────────────────────
$('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('search-input').value.trim().toUpperCase().replace(/^PLOT\s*/, '');
    if (!q) return;
    const plot = plotById.get(q) || plots.find(p => p.id.toUpperCase() === q);
    if (plot) {
        $('search-input').blur();
        selectPlot(plot.id, 'search');
    } else {
        toast(`No plot numbered “${esc(q)}”. Plots range from ${plots[0].id} upward.`);
    }
});

// ─── FILTERS ─────────────────────────────────────────
const filtersDialog = $('filters-dialog');
const filtersForm = $('filters-form');
let draft = { ...state.filter };

const FILTER_OPTIONS = {
    status: [['all', 'All'], ['Available', 'Available'], ['Sold', 'Sold']],
    zone: [['all', 'All'], ...ZONES.map(z => [z.id, z.name])],
    size: [['all', 'Any size'], ...SIZE_BUCKETS.map(b => [b.id, b.label])],
    facing: [['all', 'Any'], ['North', 'North'], ['East', 'East'], ['South', 'South'], ['West', 'West']],
};

function renderFilterPills() {
    filtersForm.querySelectorAll('.pills').forEach(group => {
        const key = group.dataset.filter;
        group.innerHTML = FILTER_OPTIONS[key].map(([value, label]) => {
            const n = plots.filter(p => matchesFilter(p, { ...draft, [key]: value })).length;
            const active = draft[key] === value;
            return `<button type="button" class="pill${active ? ' is-active' : ''}" data-key="${key}" data-value="${value}" aria-pressed="${active}"
                ${n === 0 && !active ? 'disabled' : ''}>${label}<small>${n}</small></button>`;
        }).join('');
    });
    const count = plots.filter(p => matchesFilter(p, draft)).length;
    $('filters-apply').textContent = `Show ${count} plot${count === 1 ? '' : 's'}`;
}

filtersForm.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    draft[pill.dataset.key] = pill.dataset.value;
    renderFilterPills();
});

$('filter-btn').addEventListener('click', () => {
    draft = { ...state.filter };
    renderFilterPills();
    filtersDialog.showModal();
});
$('filters-reset').addEventListener('click', () => {
    draft = { ...DEFAULT_FILTER };
    renderFilterPills();
});
filtersDialog.addEventListener('click', (e) => { if (e.target === filtersDialog) filtersDialog.close(); });
filtersDialog.addEventListener('close', () => {
    if (filtersDialog.returnValue !== 'apply') return;
    setFilter(draft);
    const n = plots.filter(p => matchesFilter(p)).length;
    if (activeFilterCount()) toast(`${n} plot${n === 1 ? '' : 's'} match your filters`);
});

on('filter', () => {
    const n = activeFilterCount();
    $('filter-count').hidden = n === 0;
    $('filter-count').textContent = n;
    $('filter-btn').classList.toggle('is-active', n > 0);
});

// ─── NEARBY (lives on the map) ───────────────────────
$('nearby-btn').addEventListener('click', async () => {
    await showView('map');
    views.map?.openNearby();
    track('view_mode', { mode: 'nearby' });
});

// ─── BOOT ────────────────────────────────────────────
document.body.dataset.view = 'plan';
compass.style.transform = `rotate(${GEO.rotationDeg}deg)`;
trackVisit();

function openFromHash() {
    const m = location.hash.match(/^#plot-(.+)$/);
    const id = m && decodeURIComponent(m[1]);
    if (id && plotById.has(id) && id !== state.selectedId) selectPlot(id, 'link');
}
window.addEventListener('hashchange', openFromHash);
openFromHash();
