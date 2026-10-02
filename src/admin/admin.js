// Builder dashboard — written for busy, non-technical site owners: plain words, big numbers,
// "who to call today" first, everything in English or Hindi. Google-style light UI.
import './admin.css';
import { SITE, plots, features, boundary } from '../shared/site.js';
import { t, getLang, setLang, sourceName, locale } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Number(n || 0).toLocaleString(locale());
const STAGES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked', 'lost'];
const ACTIVE = ['new', 'contacted', 'site_visit', 'negotiation'];
const DAY = 86400000;

const ui = { days: 7, stage: 'all', search: '', plot: null, showAllCalls: false, shown: 20 };
let stats = null;
let leads = [];

$('site-name').textContent = SITE.name;
$('login-site').textContent = SITE.name;

// ─── Helpers ─────────────────────────────────────────
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);
const prettyPhone = (p) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
const isApartment = (id) => /^[A-Z]-\d+/.test(String(id));
const what = (id) => (id ? t(isApartment(id) ? 'apartment' : 'plot', { id: esc(id) }) : '');
const prettyDate = (ymd) => new Date(ymd + 'T00:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
const initial = (name) => esc((name.trim()[0] || '?').toUpperCase());

function ago(iso) {
    if (!iso) return '—';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 90) return t('justNow');
    if (s < 3600) return t('minAgo', { n: Math.round(s / 60) });
    if (s < 86400) return t('hrAgo', { n: Math.round(s / 3600) });
    const d = Math.round(s / 86400);
    return d === 1 ? t('yesterday') : t('dayAgo', { n: d });
}

function score(l) {
    const views = (l.plots_viewed || []).reduce((s, p) => s + p.views, 0);
    const hours = l.last_seen ? (Date.now() - Date.parse(l.last_seen)) / 36e5 : 999;
    return l.visits * 2 + views + l.enquiries * 3 + (hours < 48 ? 5 : 0);
}
const isHot = (l) => ACTIVE.includes(l.status) && score(l) >= 14;

const waLink = (l) => `https://wa.me/91${l.phone}?text=${encodeURIComponent(
    `Namaste ${l.name.split(' ')[0]} ji, thank you for your interest in ${SITE.name}${l.interested_plot ? ` (${isApartment(l.interested_plot) ? 'Flat' : 'Plot'} ${l.interested_plot})` : ''}.`)}`;

const ICON = {
    call: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" fill="currentColor"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .3-3.3-.7a11.4 11.4 0 0 1-4.4-3.9c-.3-.5-1.1-1.5-1.1-2.9s.7-2 1-2.3a1 1 0 0 1 .7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.1.1.3 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.8.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    people: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.2 2.4 3.5 5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 18h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/></svg>',
    key: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="m11 12 9-9M17 6l2 2M15 8l2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 5l7 8h-4.5v6h-5v-6H5z" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 19l-7-8h4.5V5h5v6H19z" fill="currentColor"/></svg>',
};

// ─── API ─────────────────────────────────────────────
async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/session')) {
        showLogin();
        throw new Error('signed-out');
    }
    if (!res.ok) throw new Error(data.error || t('failed'));
    return data;
}

let toastTimer;
function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('is-visible');
        setTimeout(() => { el.hidden = true; }, 200);
    }, 2400);
}

// ─── Language ────────────────────────────────────────
function applyStaticText() {
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-lang-toggle]').forEach(el => { el.textContent = t('langSwitch'); });
    $('refresh').setAttribute('aria-label', t('refresh'));
    document.title = `${SITE.name} — ${t('title')}`;
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-lang-toggle]')) return;
    setLang(getLang() === 'hi' ? 'en' : 'hi');
    applyStaticText();
    if (stats) render();
});
applyStaticText();

// ─── Sign in / out ───────────────────────────────────
function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
    $('login-form').password.focus();
}

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn-primary');
    btn.disabled = true;
    $('login-error').hidden = true;
    try {
        await api('/api/admin/session', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) });
        e.target.reset();
        start();
    } catch {
        $('login-error').textContent = t('wrongPassword');
        $('login-error').hidden = false;
    } finally {
        btn.disabled = false;
    }
});

$('logout').addEventListener('click', async () => {
    await api('/api/admin/session', { method: 'DELETE' }).catch(() => {});
    document.querySelector('.menu').open = false;
    showLogin();
});

// ─── Load ────────────────────────────────────────────
let lastLoaded = 0;
async function load({ quiet = false } = {}) {
    document.body.classList.add('is-loading');
    try {
        const [s, l] = await Promise.all([api(`/api/admin/stats?days=${ui.days}`), api('/api/admin/leads')]);
        stats = s;
        leads = l.leads;
        lastLoaded = Date.now();
        render();
    } catch (err) {
        if (!quiet && err.message !== 'signed-out') toast(err.message);
    } finally {
        document.body.classList.remove('is-loading');
    }
}

let refreshTimer;
function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    load();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) load({ quiet: true });
        else updateStamp();
    }, 60000);
}
const updateStamp = () => { $('updated').textContent = lastLoaded ? t('updated', { time: ago(new Date(lastLoaded).toISOString()) }) : ''; };

$('refresh').addEventListener('click', () => load());

// ─── Render ──────────────────────────────────────────
function render() {
    updateStamp();
    const s = stats;
    const hasAnything = s.totals.leadsAll > 0 || s.totals.visitors > 0 || s.hasDemo;
    $('menu-demo').textContent = s.hasDemo ? t('demoRemove') : t('demoLoad');

    $('content').innerHTML = `
        ${s.hasDemo ? `<div class="banner"><span>${t('demoBanner')}</span><button type="button" class="btn btn-text" data-act="demo-clear">${t('demoRemove')}</button></div>` : ''}
        ${renderHello()}
        ${hasAnything ? `
            ${renderCalls()}
            ${renderKpis()}
            <section class="card" id="daily">
                <h2>${t('dailyTitle')}</h2><p class="help">${t('dailyHelp')}</p>
                <div class="chart" id="daily-chart"></div>
            </section>
            <section class="card" id="plots">
                <h2>${t('plotsTitle')}</h2><p class="help">${t('plotsHelp')}</p>
                <div class="plots-layout"><div class="plan" id="plan"></div><div>${renderPopular()}</div></div>
            </section>
            <div class="grid-2">
                ${renderSources()}
                ${renderJourney()}
            </div>
            <section class="card" id="customers">${renderCustomersShell()}</section>
        ` : renderEmpty()}`;

    if (hasAnything) {
        drawDaily();
        drawPlan();
        renderCustomerList();
    }
}

function renderHello() {
    const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
    const greet = h < 12 ? t('morning') : h < 17 ? t('afternoon') : t('evening');
    const period = t(`period${ui.days}`);
    const tot = stats.totals;
    return `<section class="hello">
        <div>
            <h2>${greet}</h2>
            <p>${tot.visitors ? t('summary', { period, visitors: fmt(tot.visitors), leads: fmt(tot.leads) }) : t('summaryNone', { period })}</p>
        </div>
        <div class="tabs" role="tablist">
            ${[7, 30, 90].map(d => `<button type="button" role="tab" class="${ui.days === d ? 'is-active' : ''}" aria-selected="${ui.days === d}" data-days="${d}">${t(`tab${d}`)}</button>`).join('')}
        </div>
    </section>`;
}

// Who to call: promised call-backs that are due, then new customers nobody has called yet
function callList() {
    const today = todayStr();
    const due = leads.filter(l => ACTIVE.includes(l.status) && l.follow_up && l.follow_up <= today)
        .map(l => ({ l, due: daysBetween(today, l.follow_up), kind: 'due' }));
    const fresh = leads.filter(l => l.status === 'new' && !(l.follow_up && l.follow_up > today) && !due.some(d => d.l.id === l.id))
        .map(l => ({ l, kind: 'new' }));
    due.sort((a, b) => b.due - a.due);
    fresh.sort((a, b) => Date.parse(b.l.created_at) - Date.parse(a.l.created_at));
    return [...due, ...fresh];
}

function renderCalls() {
    const list = callList();
    const shown = ui.showAllCalls ? list : list.slice(0, 5);
    return `<section class="card calls" id="calls">
        <div class="card-head">
            <div><h2>${t('callsTitle')} ${list.length ? `<span class="count">${list.length}</span>` : ''}</h2><p class="help">${t('callsHint')}</p></div>
        </div>
        ${list.length ? `<ul class="call-list">${shown.map(({ l, due, kind }) => {
            const reason = kind === 'new' ? t('newLead') : due === 0 ? t('dueToday') : due === 1 ? t('overdue1') : t('overdue', { n: due });
            return `<li class="call-row ${kind === 'due' && due > 0 ? 'is-late' : ''}">
                <button type="button" class="call-who" data-open="${l.id}">
                    <span class="avatar" aria-hidden="true">${initial(l.name)}</span>
                    <span class="who-text"><b>${esc(l.name)}</b><span class="reason">${reason}${l.interested_plot ? ` · ${what(l.interested_plot)}` : ''}</span></span>
                </button>
                <div class="call-actions">
                    <a class="btn btn-primary btn-sm" href="tel:+91${l.phone}">${ICON.call}<span>${t('call')}</span></a>
                    <a class="btn btn-tonal btn-sm" href="${waLink(l)}" target="_blank" rel="noopener">${ICON.wa}<span>${t('whatsapp')}</span></a>
                    <button type="button" class="btn btn-outline btn-sm" data-act="done" data-id="${l.id}">${ICON.check}<span>${t('done')}</span></button>
                    <button type="button" class="btn btn-outline btn-sm" data-act="tomorrow" data-id="${l.id}">${ICON.clock}<span>${t('later')}</span></button>
                </div>
            </li>`;
        }).join('')}</ul>
        ${list.length > 5 ? `<button type="button" class="btn btn-text more" data-act="calls-toggle">${ui.showAllCalls ? '−' : `+ ${list.length - 5}`}</button>` : ''}`
        : `<p class="all-done">${ICON.check} ${t('callsNone')}</p>`}
    </section>`;
}

function delta(cur, prev) {
    const vs = t(`prev${ui.days}`);
    if (!prev && !cur) return `<span class="delta flat">${t('same')}</span>`;
    if (!prev) return `<span class="delta up">${ICON.up}${t('newUp')}</span>`;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return `<span class="delta flat">${t('same')}</span>`;
    return `<span class="delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? ICON.up : ICON.down}${t(pct > 0 ? 'more' : 'less', { n: Math.abs(pct) })}</span><span class="vs">${vs}</span>`;
}

function renderKpis() {
    const { totals: c, previous: p } = stats;
    const tiles = [
        { k: 'kVisitors', v: c.visitors, pv: p.visitors, icon: ICON.people, tone: 'blue' },
        { k: 'kLeads', v: c.leads, pv: p.leads, icon: ICON.phone, tone: 'green' },
        { k: 'kVisits', v: c.siteVisits, pv: p.siteVisits, icon: ICON.flag, tone: 'yellow' },
        { k: 'kBooked', v: c.booked, pv: p.booked, icon: ICON.key, tone: 'red' },
    ];
    return `<section class="kpis">${tiles.map(x => `
        <div class="kpi">
            <div class="kpi-top"><span class="kpi-icon tone-${x.tone}">${x.icon}</span><span class="kpi-label">${t(x.k)}</span></div>
            <b class="kpi-value">${fmt(x.v)}</b>
            <div class="kpi-delta">${delta(x.v, x.pv)}</div>
        </div>`).join('')}</section>`;
}

function renderPopular() {
    const heat = stats.heat.filter(h => !isApartment(h.plot)).sort((a, b) => b.views - a.views || b.enquiries - a.enquiries).slice(0, 5);
    if (!heat.length) return `<p class="help">${t('noViews')}</p>`;
    const max = heat[0].views || 1;
    return `<h3>${t('popular')}</h3><ol class="popular">${heat.map((h, i) => {
        const p = plots.find(x => x.id === h.plot);
        return `<li><button type="button" data-plot="${esc(h.plot)}">
            <span class="rank">${i + 1}</span>
            <span class="pop-text"><b>${what(h.plot)}${p && p.status !== 'Available' ? ` <span class="sold-tag">${t('legendSold')}</span>` : ''}</b>
                <span class="bar-track"><i style="width:${Math.max(6, (h.views / max) * 100)}%"></i></span>
                <span class="muted">${t('views', { n: fmt(h.views) })}${h.enquiries ? ` · ${t('enquiries', { n: fmt(h.enquiries) })}` : ''}</span>
            </span>
        </button></li>`;
    }).join('')}</ol>`;
}

function renderSources() {
    const src = stats.sources.filter(s => s.visitors || s.leads);
    const max = Math.max(1, ...src.map(s => s.visitors));
    return `<section class="card">
        <h2>${t('sourcesTitle')}</h2><p class="help">${t('sourcesHelp')}</p>
        <ul class="bars">${src.map(s => `<li>
            <span class="bar-label">${esc(sourceName(s.source))}</span>
            <span class="bar-track"><i style="width:${Math.max(2, (s.visitors / max) * 100)}%"></i></span>
            <span class="bar-value">${t('sourceLine', { visitors: fmt(s.visitors), leads: fmt(s.leads) })}${s.leads === 1 ? '' : t('plural')}</span>
        </li>`).join('') || '<li class="help">—</li>'}</ul>
    </section>`;
}

function renderJourney() {
    const f = Object.fromEntries(stats.funnel.map(x => [x.id, x.n]));
    const steps = [['jVisited', f.visitors], ['jViewed', f.viewed], ['jLeads', f.leads], ['jSite', f.site_visit], ['jBooked', f.booked]];
    const top = Math.max(1, steps[0][1]);
    return `<section class="card">
        <h2>${t('journeyTitle')}</h2><p class="help">${t('journeyHelp')}</p>
        <ol class="journey">${steps.map(([k, n], i) => `<li>
            <span class="step-n">${i + 1}</span>
            <span class="step-text"><span>${t(k)}</span><span class="bar-track"><i style="width:${Math.max(2, (n / top) * 100)}%"></i></span></span>
            <b>${fmt(n)}</b>
        </li>`).join('')}</ol>
    </section>`;
}

function renderEmpty() {
    return `<section class="card empty">
        <div class="empty-art" aria-hidden="true">${ICON.people}</div>
        <h2>${t('demoEmptyTitle')}</h2>
        <p>${t('demoEmptyText')}</p>
        <button type="button" class="btn btn-primary btn-lg" data-act="demo-load">${t('demoLoad')}</button>
    </section>`;
}

// ─── Daily chart (single series, tap/hover for the number) ───
function drawDaily() {
    const el = $('daily-chart');
    const rows = stats.daily;
    const W = Math.max(300, el.clientWidth || 600);
    const H = 200;
    const m = { t: 10, r: 4, b: 26, l: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(4, ...rows.map(r => r.visitors));
    const nice = Math.ceil(max / 4) * 4;
    const step = iw / rows.length;
    const gap = rows.length > 40 ? 1 : 3;
    const bw = Math.max(2, step - gap);
    const y = (v) => m.t + ih - (v / nice) * ih;
    const label = (d, opts) => new Date(d + 'T00:00:00').toLocaleDateString(locale(), opts);
    const grid = [0, 0.5, 1].map(f => {
        const v = Math.round(nice * f);
        return `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${m.l - 8}" y="${y(v)}" class="axis" text-anchor="end" dominant-baseline="central">${fmt(v)}</text>`;
    }).join('');
    const r = Math.min(4, bw / 2);
    const bars = rows.map((d, i) => {
        const x = m.l + i * step + gap / 2, top = y(d.visitors), base = m.t + ih;
        const path = d.visitors > 0 ? `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z` : '';
        return `<g class="bar" data-i="${i}"><rect class="hit" x="${m.l + i * step}" y="${m.t}" width="${step}" height="${ih}"/>${path ? `<path d="${path}"/>` : ''}</g>`;
    }).join('');
    const ticks = [0, Math.floor(rows.length / 2), rows.length - 1].map((i, k) =>
        `<text x="${m.l + i * step + step / 2}" y="${H - 6}" class="axis" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">${label(rows[i].day, { day: 'numeric', month: 'short' })}</text>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(t('dailyTitle'))}">${grid}${bars}${ticks}</svg>`;

    const svg = el.querySelector('svg');
    const show = (g) => {
        svg.querySelectorAll('.bar').forEach(b => b.classList.toggle('is-on', b === g));
        if (!g) { $('tip').hidden = true; return; }
        const d = rows[Number(g.dataset.i)];
        tip(g.getBoundingClientRect(), label(d.day, { weekday: 'long', day: 'numeric', month: 'long' }), t('dailyTip', { visitors: fmt(d.visitors), leads: fmt(d.leads) }));
    };
    svg.addEventListener('pointermove', (e) => { const g = e.target.closest('.bar'); if (g) show(g); });
    svg.addEventListener('click', (e) => show(e.target.closest('.bar')));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(null); });
}

function tip(rect, title, line) {
    const el = $('tip');
    el.replaceChildren();
    const b = document.createElement('b');
    b.textContent = title;
    const s = document.createElement('span');
    s.textContent = line;
    el.append(b, s);
    el.hidden = false;
    el.style.left = `${Math.min(window.innerWidth - 110, Math.max(110, rect.left + rect.width / 2))}px`;
    el.style.top = `${rect.top + window.scrollY - 10}px`;
}
document.addEventListener('scroll', () => { $('tip').hidden = true; }, { passive: true });

// ─── Interest on the real site plan (one blue hue, darker = more looks) ───
const RAMP = ['#e8f0fe', '#c6dafc', '#8ab4f8', '#4285f4', '#1967d2', '#174ea6'];
function drawPlan() {
    const el = $('plan');
    const by = new Map(stats.heat.map(h => [String(h.plot), h]));
    const vals = plots.map(p => by.get(p.id)?.views || 0).filter(v => v > 0).sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] || 0;
    const edges = [q(0.2), q(0.4), q(0.6), q(0.8)];
    const binOf = (v) => 1 + edges.filter(e => v > e).length;
    const colorOf = (v) => (v <= 0 ? '#f1f3f4' : RAMP[binOf(v)]);
    // Frame the plotted area (the big future-phase block would just waste space)
    const framed = features.filter(f => f.kind === 'plot' || f.kind === 'road');
    const b = framed.reduce((r, f) => ({
        minX: Math.min(r.minX, f.box.minX), minY: Math.min(r.minY, f.box.minY),
        maxX: Math.max(r.maxX, f.box.maxX), maxY: Math.max(r.maxY, f.box.maxY),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const poly = (pts) => pts.map(p => p.join(',')).join(' ');
    el.innerHTML = `<svg viewBox="${b.minX - 8} ${b.minY - 8} ${b.maxX - b.minX + 16} ${b.maxY - b.minY + 16}" role="img" aria-label="${esc(t('plotsTitle'))}">
        <defs><pattern id="sold" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#5f6368" stroke-width="1.6" stroke-opacity=".5"/></pattern></defs>
        <polygon points="${poly(boundary.points)}" class="pl-boundary"/>
        ${features.filter(f => f.kind === 'common').map(f => `<polygon points="${poly(f.points)}" class="pl-green"/>`).join('')}
        ${features.filter(f => f.kind === 'road').map(f => `<polygon points="${poly(f.points)}" class="pl-road"/>`).join('')}
        ${plots.map(p => {
            const v = by.get(p.id)?.views || 0;
            return `<g class="pl-plot${ui.plot === p.id ? ' is-picked' : ''}" data-plot="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(what(p.id))}: ${esc(t('views', { n: v }))}">
                <polygon points="${poly(p.points)}" fill="${colorOf(v)}"/>
                ${p.status !== 'Available' ? `<polygon points="${poly(p.points)}" fill="url(#sold)"/>` : ''}
                <text x="${p.center[0]}" y="${p.center[1]}" class="${v > 0 && binOf(v) >= 4 ? 'on-dark' : ''}">${esc(p.id)}</text>
            </g>`;
        }).join('')}
    </svg>
    <div class="legend">
        <span><i style="background:#f1f3f4"></i>${t('legendNone')}</span>
        <span class="ramp"><em>${t('legendFew')}</em>${RAMP.slice(1).map(c => `<i style="background:${c}"></i>`).join('')}<em>${t('legendMany')}</em></span>
        <span><i class="sold"></i>${t('legendSold')}</span>
    </div>`;
    const svg = el.querySelector('svg');
    svg.addEventListener('pointermove', (e) => {
        const g = e.target.closest('.pl-plot');
        if (!g || e.pointerType !== 'mouse') return;
        const h = by.get(g.dataset.plot);
        tip(g.getBoundingClientRect(), what(g.dataset.plot), `${t('views', { n: fmt(h?.views || 0) })} · ${t('enquiries', { n: fmt(h?.enquiries || 0) })}`);
    });
    svg.addEventListener('pointerleave', () => { $('tip').hidden = true; });
}

// ─── Customers ───────────────────────────────────────
function renderCustomersShell() {
    return `<div class="card-head">
            <h2>${t('customers')} <span class="count">${fmt(leads.length)}</span></h2>
            <button type="button" class="btn btn-outline btn-sm" data-act="export">${t('exportExcel')}</button>
        </div>
        <label class="search">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <input type="search" id="search" placeholder="${esc(t('search'))}" value="${esc(ui.search)}" aria-label="${esc(t('search'))}">
        </label>
        <div class="chips scroll" id="stage-chips"></div>
        <ul class="customer-list" id="customer-list"></ul>`;
}

function filteredLeads() {
    const q = ui.search.toLowerCase().replace(/\s/g, '');
    return leads.filter(l => {
        if (ui.stage === 'hot' ? !isHot(l) : ui.stage !== 'all' && l.status !== ui.stage) return false;
        if (ui.plot && l.interested_plot !== ui.plot && !(l.plots_viewed || []).some(p => p.plot === ui.plot)) return false;
        if (!q) return true;
        return l.name.toLowerCase().replace(/\s/g, '').includes(q) || l.phone.includes(q)
            || String(l.interested_plot || '').toLowerCase() === q || (l.plots_viewed || []).some(p => String(p.plot).toLowerCase() === q);
    });
}

function renderCustomerList() {
    const counts = { all: leads.length, hot: leads.filter(isHot).length };
    STAGES.forEach(s => { counts[s] = leads.filter(l => l.status === s).length; });
    $('stage-chips').innerHTML = [
        ...(ui.plot ? [`<button type="button" class="chip is-active picked" data-act="clear-plot">${what(ui.plot)} ${ICON.close}</button>`] : []),
        ...['all', 'hot', ...STAGES].map(s => `<button type="button" class="chip${ui.stage === s ? ' is-active' : ''}" data-stage="${s}">
            ${s === 'all' ? t('all') : s === 'hot' ? `🔥 ${t('hot')}` : `<i class="dot st-${s}"></i>${t(`stage_${s}`)}`}<small>${counts[s]}</small></button>`),
    ].join('');
    const list = filteredLeads().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const today = todayStr();
    $('customer-list').innerHTML = list.length ? list.slice(0, ui.shown).map(l => `<li>
        <button type="button" class="customer" data-open="${l.id}">
            <span class="avatar" aria-hidden="true">${initial(l.name)}</span>
            <span class="who-text">
                <b>${esc(l.name)}${isHot(l) ? ' 🔥' : ''}</b>
                <span>${prettyPhone(l.phone)}${l.interested_plot ? ` · ${what(l.interested_plot)}` : ''}</span>
                <span class="small">${l.follow_up && ACTIVE.includes(l.status)
                    ? `<span class="${l.follow_up < today ? 'late' : ''}">${ICON.clock} ${t('callOn', { date: prettyDate(l.follow_up) })}</span>`
                    : t('lastSeen', { time: ago(l.last_seen || l.updated_at) })}</span>
            </span>
            <span class="stage st-${l.status}">${t(`stage_${l.status}`)}</span>
        </button>
    </li>`).join('') + (list.length > ui.shown
        ? `<li class="show-more"><button type="button" class="btn btn-outline" data-act="more">${t('showMore', { n: fmt(list.length - ui.shown) })}</button></li>` : '')
        : !leads.length && !stats.hasDemo
        ? `<li class="none"><p class="help">${t('demoEmptyText')}</p><button type="button" class="btn btn-tonal" data-act="demo-load">${t('demoLoad')}</button></li>`
        : `<li class="help none">${ui.plot ? t('noCustomersPlot', { what: what(ui.plot) }) : t('noCustomers')}</li>`;
}

// ─── Customer details ────────────────────────────────
const dialog = $('customer');
let current = null;

async function openCustomer(id) {
    const l = leads.find(x => x.id === id);
    if (!l) return;
    current = { id, status: l.status, follow_up: l.follow_up || '' };
    const viewed = l.plots_viewed || [];
    $('customer-body').innerHTML = `
        <header class="sheet-head">
            <span class="avatar lg" aria-hidden="true">${initial(l.name)}</span>
            <div class="who-text"><h2>${esc(l.name)}${isHot(l) ? ' 🔥' : ''}</h2>
                <span>${prettyPhone(l.phone)} · ${t('fromSource', { source: esc(sourceName(l.source)) })}</span></div>
            <button type="button" class="btn btn-ghost icon-only" data-act="close" aria-label="${esc(t('close'))}">${ICON.close}</button>
        </header>
        <div class="contact">
            <a class="btn btn-primary btn-lg" href="tel:+91${l.phone}">${ICON.call}${t('call')}</a>
            <a class="btn btn-tonal btn-lg" href="${waLink(l)}" target="_blank" rel="noopener">${ICON.wa}${t('whatsapp')}</a>
        </div>
        <section><h3>${t('stage')}</h3>
            <div class="stage-grid">${STAGES.map(s => `<button type="button" class="stage-btn${s === l.status ? ' is-active' : ''}" data-stage-set="${s}" aria-pressed="${s === l.status}"><i class="dot st-${s}"></i>${t(`stage_${s}`)}</button>`).join('')}</div>
        </section>
        <section><h3>${t('callAgain')}</h3>
            <div class="chips" id="follow-chips"></div>
            <input type="date" id="follow-date" class="date" aria-label="${esc(t('callAgain'))}">
        </section>
        <section><h3>${t('notes')}</h3>
            <textarea id="notes" rows="3" maxlength="2000" placeholder="${esc(t('notesHint'))}">${esc(l.notes || '')}</textarea>
        </section>
        <section><h3>${t('lookedAt')}</h3>
            <div class="chips">${viewed.length ? viewed.map(p => `<a class="chip" href="/${isApartment(p.plot) ? `buildings/?unit=${encodeURIComponent(p.plot)}` : `#plot-${encodeURIComponent(p.plot)}`}" target="_blank" rel="noopener">${what(p.plot)}<small>×${p.views}</small></a>`).join('')
                : `<span class="help">${l.interested_plot ? what(l.interested_plot) : t('general')}</span>`}</div>
        </section>
        <section><h3>${t('history')}</h3><ul class="timeline" id="timeline"><li class="help">…</li></ul>
            <p class="help">${t('firstEnquiry', { date: new Date(l.created_at).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) })} · ${t('visitsN', { n: l.visits })}</p>
        </section>
        <footer class="sheet-foot"><button type="button" class="btn btn-primary btn-lg" data-act="save">${t('save')}</button></footer>`;
    renderFollowChips();
    dialog.showModal();
    try {
        const { timeline } = await api(`/api/admin/leads?id=${id}`);
        const MODE = { '3d': '3D', map: 'Map', nearby: 'Nearby', plan: 'Plan' };
        $('timeline').innerHTML = timeline.filter(e => e.type !== 'view_mode' || e.detail).slice(0, 12).map(e => `<li>
            <span class="tl-dot" aria-hidden="true"></span>
            <span>${t(`ev_${e.type}`, { what: e.type === 'view_mode' ? esc(MODE[e.detail] || e.detail) : what(e.plot_id) || '—' })}</span>
            <small>${ago(e.created_at)}</small></li>`).join('') || '<li class="help">—</li>';
    } catch { $('timeline').innerHTML = ''; }
}

function renderFollowChips() {
    const today = todayStr();
    const opts = [['today', today], ['tomorrow', addDays(today, 1)], ['in3', addDays(today, 3)], ['nextWeek', addDays(today, 7)], ['noDate', '']];
    $('follow-chips').innerHTML = opts.map(([k, v]) => `<button type="button" class="chip${current.follow_up === v ? ' is-active' : ''}" data-follow="${v}">${t(k)}</button>`).join('');
    $('follow-date').value = current.follow_up;
}

dialog.addEventListener('click', async (e) => {
    if (e.target === dialog) return dialog.close();
    const stageBtn = e.target.closest('[data-stage-set]');
    if (stageBtn) {
        current.status = stageBtn.dataset.stageSet;
        dialog.querySelectorAll('[data-stage-set]').forEach(b => {
            b.classList.toggle('is-active', b === stageBtn);
            b.setAttribute('aria-pressed', b === stageBtn);
        });
        if (['booked', 'lost'].includes(current.status)) { current.follow_up = ''; renderFollowChips(); }
        return;
    }
    const f = e.target.closest('[data-follow]');
    if (f) { current.follow_up = f.dataset.follow; renderFollowChips(); return; }
    const actEl = e.target.closest('[data-act]');
    if (actEl?.dataset.act === 'close') dialog.close();
    if (actEl?.dataset.act === 'save') {
        actEl.disabled = true;
        try {
            await updateLead(current.id, { status: current.status, notes: $('notes').value, follow_up: current.follow_up || null });
            dialog.close();
            toast(t('saved'));
        } catch (err) { toast(err.message); } finally { actEl.disabled = false; }
    }
});
dialog.addEventListener('change', (e) => {
    if (e.target.id === 'follow-date') { current.follow_up = e.target.value; renderFollowChips(); }
});

async function updateLead(id, patch) {
    await api('/api/admin/leads', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) });
    const l = leads.find(x => x.id === id);
    if (l) Object.assign(l, patch);
    render();
}

// ─── Page-level actions ──────────────────────────────
$('content').addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-days]');
    if (tab) { ui.days = Number(tab.dataset.days); load(); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openCustomer(Number(open.dataset.open)); return; }
    const plotBtn = e.target.closest('[data-plot]');
    if (plotBtn) {
        ui.plot = plotBtn.dataset.plot;
        ui.stage = 'all';
        render();
        $('customers').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const stage = e.target.closest('[data-stage]');
    if (stage) { ui.stage = stage.dataset.stage; ui.shown = 20; renderCustomerList(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    try {
        switch (btn.dataset.act) {
            case 'done': {
                const l = leads.find(x => x.id === id);
                await updateLead(id, { status: l.status === 'new' ? 'contacted' : l.status, follow_up: null });
                toast(t('markedDone'));
                break;
            }
            case 'tomorrow':
                await updateLead(id, { follow_up: addDays(todayStr(), 1) });
                toast(t('movedTomorrow'));
                break;
            case 'calls-toggle': ui.showAllCalls = !ui.showAllCalls; render(); break;
            case 'clear-plot': ui.plot = null; renderCustomerList(); break;
            case 'more': ui.shown += 20; renderCustomerList(); break;
            case 'export': exportCsv(); break;
            case 'demo-load': loadDemo(btn); break;
            case 'demo-clear': clearDemo(); break;
        }
    } catch (err) { toast(err.message); }
});
$('content').addEventListener('input', (e) => {
    if (e.target.id === 'search') { ui.search = e.target.value.trim(); ui.shown = 20; renderCustomerList(); }
});
$('content').addEventListener('keydown', (e) => {
    const g = e.target.closest?.('.pl-plot');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});

$('menu-demo').addEventListener('click', (e) => {
    document.querySelector('.menu').open = false;
    if (stats?.hasDemo) clearDemo(); else loadDemo(e.target);
});

// Sample data weighted like real buyers behave: available, corner, east/north-facing plots get more looks
async function loadDemo(btn) {
    const weights = plots.map(p => {
        let w = p.status === 'Available' ? 1.4 : 0.6;
        if (p.facing.length > 1) w += 0.9;
        if (p.facing.some(f => f.dir === 'East' || f.dir === 'North')) w += 0.5;
        if (p.zone === 'A' || p.zone === 'B') w += 0.3;
        if (p.areaSqFt > 2000) w += 0.4;
        return [p.id, +w.toFixed(2)];
    });
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = t('demoLoading'); }
    try {
        await api('/api/admin/demo', { method: 'POST', body: JSON.stringify({ plots: weights }) });
        toast(t('demoAdded'));
        await load();
    } catch (err) {
        toast(err.message);
        if (btn) { btn.disabled = false; btn.textContent = label; }
    }
}

async function clearDemo() {
    if (!confirm(t('demoConfirm'))) return;
    try {
        await api('/api/admin/demo', { method: 'DELETE' });
        toast(t('demoRemoved'));
        ui.plot = null;
        await load();
    } catch (err) { toast(err.message); }
}

// ─── Excel (CSV) download ────────────────────────────
function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=@\t\r]/.test(s) || /^[+-](?!\d+$)/.test(s)) s = `'${s}`; // no spreadsheet formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv() {
    const list = filteredLeads();
    const head = ['Name', 'Mobile', 'Stage', 'Interested in', 'Looked at', 'Call again on', 'Came from', 'Visits', 'First enquiry', 'Last seen', 'Notes'];
    const rows = list.map(l => [
        l.name, `+91${l.phone}`, t(`stage_${l.status}`), l.interested_plot || '',
        (l.plots_viewed || []).map(p => `${p.plot} (${p.views})`).join('; '),
        l.follow_up || '', sourceName(l.source), l.visits,
        new Date(l.created_at).toLocaleString('en-IN'), l.last_seen ? new Date(l.last_seen).toLocaleString('en-IN') : '', l.notes || '',
    ]);
    const csv = '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `customers-${todayStr()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (stats && $('daily-chart')) drawDaily(); }, 150);
});

// ─── Boot ────────────────────────────────────────────
api('/api/admin/session').then(({ authed }) => (authed ? start() : showLogin())).catch(showLogin);
