import './admin.css';
import { SITE } from '../shared/site.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

const STATUSES = [
    { id: 'new', label: 'New' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'site_visit', label: 'Site visit' },
    { id: 'negotiation', label: 'Negotiation' },
    { id: 'booked', label: 'Booked' },
    { id: 'lost', label: 'Not interested' },
];
const statusLabel = (id) => STATUSES.find(s => s.id === id)?.label || id;

const ui = { days: 30, status: 'all', search: '', sort: 'recent' };
let leads = [];
let stats = null;

document.title = `Leads — ${SITE.name}`;
$('site-name').textContent = SITE.name;
$('login-site').textContent = SITE.name;

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
        throw new Error('Signed out');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

// ─── TOAST ───────────────────────────────────────────
let toastTimer;
function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('is-visible');
        setTimeout(() => { el.hidden = true; }, 250);
    }, 2600);
}

// ─── AUTH ────────────────────────────────────────────
function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
    $('login-form').password.focus();
}

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('login-error').hidden = true;
    try {
        await api('/api/admin/session', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) });
        e.target.reset();
        start();
    } catch (err) {
        $('login-error').textContent = err.message;
        $('login-error').hidden = false;
    } finally {
        btn.disabled = false;
    }
});

$('logout').addEventListener('click', async () => {
    await api('/api/admin/session', { method: 'DELETE' }).catch(() => {});
    showLogin();
});

// ─── LOAD ────────────────────────────────────────────
async function load({ quiet = false } = {}) {
    document.body.classList.add('is-loading');
    try {
        const [s, l] = await Promise.all([api(`/api/admin/stats?days=${ui.days}`), api('/api/admin/leads')]);
        stats = s;
        leads = l.leads;
        renderStats();
        renderLeads();
        $('updated').textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
    } catch (err) {
        if (!quiet && err.message !== 'Signed out') toast(err.message);
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
    refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') load({ quiet: true }); }, 60000);
}

$('refresh').addEventListener('click', () => load());
$('range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui.days = Number(b.dataset.days);
    $('range').querySelectorAll('button').forEach(x => {
        x.classList.toggle('is-active', x === b);
        x.setAttribute('aria-checked', x === b);
    });
    load();
});

// ─── KPIs ────────────────────────────────────────────
function renderStats() {
    const t = stats.totals;
    const inRange = stats.daily.reduce((a, d) => ({ v: a.v + d.visitors, l: a.l + d.leads }), { v: 0, l: 0 });
    const conv = t.visitors ? (t.leads / t.visitors) * 100 : 0;
    const tiles = [
        { label: 'Leads captured', value: fmt(t.leads), sub: `${fmt(t.leads_7d)} in last 7 days`, accent: true },
        { label: 'Unique visitors', value: fmt(t.visitors), sub: `${fmt(t.visitors_7d)} new in last 7 days` },
        { label: 'Conversion', value: `${conv.toFixed(1)}%`, sub: 'visitors who shared their number' },
        { label: 'Total visits', value: fmt(t.visits), sub: t.visitors ? `${(t.visits / t.visitors).toFixed(1)} per visitor` : '—' },
        { label: `Last ${ui.days} days`, value: `${fmt(inRange.l)} lead${inRange.l === 1 ? '' : 's'}`, sub: `from ${fmt(inRange.v)} visitor-days` },
        { label: 'On mobile', value: t.visitors ? `${Math.round((t.mobile / t.visitors) * 100)}%` : '—', sub: 'of visitors' },
    ];
    $('kpis').innerHTML = tiles.map(k => `
        <div class="kpi${k.accent ? ' accent' : ''}">
            <span>${k.label}</span><b>${k.value}</b><small>${k.sub}</small>
        </div>`).join('');

    barChart($('chart-visitors'), stats.daily, 'visitors', 'visitor', 'visitors');
    barChart($('chart-leads'), stats.daily, 'leads', 'lead', 'leads');

    const max = Math.max(1, ...stats.topPlots.map(p => p.views));
    $('top-plots').innerHTML = stats.topPlots.length
        ? stats.topPlots.map(p => `
            <li>
                <span class="tp-name">Plot ${esc(p.plot)}</span>
                <span class="tp-bar"><i style="width:${(p.views / max) * 100}%"></i></span>
                <span class="tp-val"><b>${fmt(p.views)}</b> view${p.views === 1 ? '' : 's'}${p.enquiries ? ` · ${fmt(p.enquiries)} enq.` : ''}</span>
            </li>`).join('')
        : '<li class="empty">No plot views yet</li>';
}

// ─── BAR CHART (single series, hover + keyboard) ─────
function barChart(el, rows, key, singular, plural) {
    const W = Math.max(280, el.clientWidth || 600);
    const H = 180;
    const m = { t: 12, r: 8, b: 24, l: 30 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const max = Math.max(...rows.map(r => r[key]));
    const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
    const step = iw / rows.length;
    const gap = rows.length > 45 ? 1 : 2;
    const bw = Math.max(1, step - gap);
    const y = (v) => m.t + ih - (v / niceMax) * ih;
    const r = Math.min(4, bw / 2);
    const label = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const longLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

    const grid = [0, 0.5, 1].map(f => {
        const v = Math.round(niceMax * f);
        return `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
                <text x="${m.l - 6}" y="${y(v)}" class="axis" text-anchor="end" dominant-baseline="central">${v}</text>`;
    }).join('');

    const bars = rows.map((d, i) => {
        const v = d[key];
        const x = m.l + i * step + gap / 2;
        const top = y(v);
        const h = m.t + ih - top;
        const path = v > 0
            ? `M${x},${m.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ih} Z`
            : '';
        return `<g class="bar" data-i="${i}">
            <rect class="hit" x="${m.l + i * step}" y="${m.t}" width="${step}" height="${ih}"/>
            ${path ? `<path d="${path}" class="mark"/>` : `<rect x="${x}" y="${m.t + ih - 1}" width="${bw}" height="1" class="zero"/>`}
        </g>`;
    }).join('');

    const ticks = [0, Math.floor(rows.length / 2), rows.length - 1].map(i =>
        `<text x="${m.l + i * step + step / 2}" y="${H - 6}" class="axis" text-anchor="${i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}">${label(rows[i].day)}</text>`).join('');

    const total = rows.reduce((s, r) => s + r[key], 0);
    el.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" tabindex="0" role="img"
             aria-label="${plural} per day, ${rows.length} days, total ${total}. Use arrow keys to read each day.">
            ${grid}${bars}${ticks}
        </svg>
        <div class="chart-tip" hidden></div>
        ${total === 0 ? `<div class="chart-empty">No ${plural} in this period yet</div>` : ''}
        <details class="table-view"><summary>View as table</summary>
            <table><thead><tr><th>Date</th><th>${plural}</th></tr></thead>
            <tbody>${rows.slice().reverse().map(r => `<tr><td>${longLabel(r.day)}</td><td>${r[key]}</td></tr>`).join('')}</tbody></table>
        </details>`;

    const svg = el.querySelector('svg');
    const tip = el.querySelector('.chart-tip');
    let active = -1;
    const show = (i) => {
        active = i;
        svg.querySelectorAll('.bar').forEach(b => b.classList.toggle('is-hover', Number(b.dataset.i) === i));
        if (i < 0) { tip.hidden = true; return; }
        const d = rows[i];
        tip.innerHTML = '';
        const b = document.createElement('b');
        b.textContent = `${d[key]} ${d[key] === 1 ? singular : plural}`;
        const s = document.createElement('span');
        s.textContent = longLabel(d.day);
        tip.append(b, s);
        tip.hidden = false;
        const scale = svg.getBoundingClientRect().width / W;
        const cx = (m.l + i * step + step / 2) * scale;
        tip.style.left = `${Math.min(Math.max(cx, 50), svg.getBoundingClientRect().width - 50)}px`;
        tip.style.top = `${y(d[key]) * scale - 8}px`;
    };
    svg.addEventListener('pointermove', (e) => {
        const g = e.target.closest('.bar');
        if (g) show(Number(g.dataset.i));
    });
    svg.addEventListener('pointerleave', () => show(-1));
    svg.addEventListener('blur', () => show(-1));
    svg.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') show(Math.min(rows.length - 1, active + 1));
        else if (e.key === 'ArrowLeft') show(Math.max(0, active < 0 ? rows.length - 1 : active - 1));
        else return;
        e.preventDefault();
    });
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (stats) renderStats(); }, 150);
});

// ─── LEADS ───────────────────────────────────────────
function score(l) {
    const views = (l.plots_viewed || []).reduce((s, p) => s + p.views, 0);
    const hours = l.last_seen ? (Date.now() - Date.parse(l.last_seen)) / 36e5 : 999;
    return l.visits * 2 + views + l.enquiries * 3 + (hours < 48 ? 5 : 0);
}
const isHot = (l) => !['booked', 'lost'].includes(l.status) && score(l) >= 12;

function relTime(iso) {
    if (!iso) return '—';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const fullDate = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const prettyPhone = (p) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
const waLink = (l) => `https://wa.me/91${l.phone}?text=${encodeURIComponent(`Hi ${l.name.split(' ')[0]}, thanks for your interest in ${SITE.name}${l.interested_plot ? ` (Plot ${l.interested_plot})` : ''}.`)}`;

function visibleLeads() {
    const q = ui.search.toLowerCase().replace(/\s/g, '');
    let list = leads.filter(l => ui.status === 'all' || (ui.status === 'hot' ? isHot(l) : l.status === ui.status));
    if (q) {
        list = list.filter(l =>
            l.name.toLowerCase().replace(/\s/g, '').includes(q) ||
            l.phone.includes(q) ||
            String(l.interested_plot || '').toLowerCase() === q ||
            (l.plots_viewed || []).some(p => String(p.plot).toLowerCase() === q));
    }
    const by = {
        recent: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
        hot: (a, b) => score(b) - score(a),
        active: (a, b) => Date.parse(b.last_seen || 0) - Date.parse(a.last_seen || 0),
    }[ui.sort];
    return list.sort(by);
}

function renderTabs() {
    const counts = { all: leads.length, hot: leads.filter(isHot).length };
    STATUSES.forEach(s => { counts[s.id] = leads.filter(l => l.status === s.id).length; });
    const tabs = [{ id: 'all', label: 'All' }, { id: 'hot', label: '🔥 Hot' }, ...STATUSES];
    $('status-tabs').innerHTML = tabs.map(t => `
        <button role="tab" data-status="${t.id}" class="${ui.status === t.id ? 'is-active' : ''}" aria-selected="${ui.status === t.id}">
            ${t.label}<small>${counts[t.id]}</small>
        </button>`).join('');
}

function renderLeads() {
    renderTabs();
    const list = visibleLeads();
    $('lead-count').textContent = leads.length ? `${list.length}${list.length !== leads.length ? ` of ${leads.length}` : ''}` : '';
    if (!leads.length) {
        $('lead-list').innerHTML = `<div class="empty-state">
            <b>No leads yet</b>
            <p class="muted">When customers share their mobile number on the site plan, they'll appear here with the plots they looked at.</p>
        </div>`;
        return;
    }
    if (!list.length) {
        $('lead-list').innerHTML = '<div class="empty-state"><p class="muted">No leads match this filter.</p></div>';
        return;
    }
    $('lead-list').innerHTML = `
        <div class="lead-row lead-header" aria-hidden="true">
            <span>Customer</span><span>Interested in</span><span>Plots viewed</span><span>Engagement</span><span>Last active</span><span>Status</span>
        </div>
        ${list.map(l => `
        <button class="lead-row" data-id="${l.id}">
            <span class="lc-name">
                <b>${esc(l.name)}${isHot(l) ? ' <i class="hot" title="Highly engaged">🔥</i>' : ''}</b>
                <small>${prettyPhone(l.phone)}</small>
            </span>
            <span class="lc-plot" data-label="Interested">${l.interested_plot ? `Plot ${esc(l.interested_plot)}` : '<span class="muted">General</span>'}</span>
            <span class="lc-viewed" data-label="Viewed">${(l.plots_viewed || []).slice(0, 4).map(p => `<i class="chip">${esc(p.plot)}${p.views > 1 ? `<small>×${p.views}</small>` : ''}</i>`).join('') || '<span class="muted">—</span>'}${(l.plots_viewed || []).length > 4 ? `<small class="muted">+${l.plots_viewed.length - 4}</small>` : ''}</span>
            <span class="lc-eng" data-label="Engagement">${l.visits} visit${l.visits === 1 ? '' : 's'} · ${l.enquiries} enq.</span>
            <span class="lc-seen" data-label="Last active" title="${fullDate(l.last_seen)}">${relTime(l.last_seen || l.updated_at)}</span>
            <span class="lc-status"><i class="status s-${l.status}">${statusLabel(l.status)}</i></span>
        </button>`).join('')}`;
}

$('status-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui.status = b.dataset.status;
    renderLeads();
});
$('lead-search').addEventListener('input', (e) => { ui.search = e.target.value.trim(); renderLeads(); });
$('lead-sort').addEventListener('change', (e) => { ui.sort = e.target.value; renderLeads(); });
$('lead-list').addEventListener('click', (e) => {
    const row = e.target.closest('.lead-row[data-id]');
    if (row) openLead(Number(row.dataset.id));
});

// ─── LEAD DETAIL ─────────────────────────────────────
const dialog = $('lead-dialog');
const form = $('lead-detail');

function openLead(id) {
    const l = leads.find(x => x.id === id);
    if (!l) return;
    form.innerHTML = `
        <header class="modal-head">
            <div>
                <h2>${esc(l.name)}${isHot(l) ? ' 🔥' : ''}</h2>
                <p class="muted">${prettyPhone(l.phone)} · first enquiry ${fullDate(l.created_at)}</p>
            </div>
            <button class="icon-btn" value="cancel" aria-label="Close">✕</button>
        </header>
        <div class="contact-actions">
            <a class="btn-primary" href="tel:+91${l.phone}">Call</a>
            <a class="btn-ghost" href="${waLink(l)}" target="_blank" rel="noopener">WhatsApp</a>
            <button type="button" class="btn-ghost" data-copy="${l.phone}">Copy number</button>
        </div>
        <dl class="detail-grid">
            <div><dt>Interested in</dt><dd>${l.interested_plot ? `Plot ${esc(l.interested_plot)}` : 'General enquiry'}</dd></div>
            <div><dt>Visits</dt><dd>${l.visits}</dd></div>
            <div><dt>Enquiries</dt><dd>${l.enquiries}</dd></div>
            <div><dt>Last active</dt><dd>${relTime(l.last_seen || l.updated_at)}</dd></div>
            <div><dt>Device</dt><dd>${l.is_mobile ? 'Mobile' : l.is_mobile === false ? 'Desktop' : '—'}</dd></div>
        </dl>
        ${l.message ? `<p class="message">“${esc(l.message)}”</p>` : ''}
        <div>
            <h3>Plots viewed</h3>
            <div class="viewed-list">${(l.plots_viewed || []).map(p =>
                `<a class="chip" href="/#plot-${encodeURIComponent(p.plot)}" target="_blank" rel="noopener">Plot ${esc(p.plot)}<small>${p.views} view${p.views === 1 ? '' : 's'}</small></a>`).join('') || '<span class="muted">No plots opened yet</span>'}</div>
        </div>
        <label class="field">
            <span>Status</span>
            <select name="status">${STATUSES.map(s => `<option value="${s.id}" ${s.id === l.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        </label>
        <label class="field">
            <span>Notes</span>
            <textarea name="notes" rows="3" maxlength="2000" placeholder="Budget, preferred plot size, follow-up date…">${esc(l.notes || '')}</textarea>
        </label>
        <footer class="modal-foot">
            <button class="btn-ghost" value="cancel">Cancel</button>
            <button class="btn-primary" value="save" type="button" data-save>Save</button>
        </footer>`;
    form.dataset.id = id;
    dialog.showModal();
}

form.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Number copied'));
        return;
    }
    if (!e.target.closest('[data-save]')) return;
    const id = Number(form.dataset.id);
    const btn = e.target.closest('[data-save]');
    btn.disabled = true;
    try {
        const body = { id, status: form.status.value, notes: form.notes.value };
        await api('/api/admin/leads', { method: 'PATCH', body: JSON.stringify(body) });
        Object.assign(leads.find(l => l.id === id), { status: body.status, notes: body.notes });
        renderLeads();
        dialog.close();
        toast('Lead updated');
    } catch (err) {
        toast(err.message);
    } finally {
        btn.disabled = false;
    }
});
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

// ─── CSV EXPORT ──────────────────────────────────────
function csvCell(v) {
    let s = String(v ?? '');
    // avoid spreadsheet formula injection (a plain +91… phone number is fine)
    if (/^[=@\t\r]/.test(s) || /^[+-](?!\d+$)/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$('export').addEventListener('click', () => {
    const list = visibleLeads();
    if (!list.length) return toast('No leads to export');
    const header = ['Name', 'Mobile', 'Status', 'Interested plot', 'Plots viewed', 'Visits', 'Enquiries', 'First enquiry', 'Last active', 'Notes'];
    const rows = list.map(l => [
        l.name, `+91${l.phone}`, statusLabel(l.status), l.interested_plot || '',
        (l.plots_viewed || []).map(p => `${p.plot} (${p.views})`).join('; '),
        l.visits, l.enquiries, fullDate(l.created_at), fullDate(l.last_seen), l.notes || '',
    ]);
    const csv = '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ─── BOOT ────────────────────────────────────────────
api('/api/admin/session')
    .then(({ authed }) => (authed ? start() : showLogin()))
    .catch(showLogin);
