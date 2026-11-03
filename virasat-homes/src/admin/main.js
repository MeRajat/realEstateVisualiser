// Virasat Homes admin: overview, plot stock on the plan, customer enquiries. Talks to /api/virasat/admin/*.
import './admin.css';
import { createPlanView } from '../shared/planview.js';
import { STATUS, STATUS_ORDER, plotById as layoutById, plotSort, fmtNum, fmtMoney, findPlot } from '../shared/plots.js';

const API = '/api/virasat';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

const STAGES = {
    new: { label: 'New', color: '#1a73e8' },
    contacted: { label: 'Called', color: '#7b1fa2' },
    site_visit: { label: 'Site visit', color: '#f29900' },
    negotiation: { label: 'Talking price', color: '#e8710a' },
    booked: { label: 'Booked', color: '#1e8e3e' },
    lost: { label: 'Not interested', color: '#80868b' },
};

async function api(path, opts = {}) {
    const r = await fetch(API + path, {
        ...opts,
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/admin/session') { showLogin(); throw new Error('Please sign in again'); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status, data: j });
    return j;
}

let toastTimer;
function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

const ago = (iso) => {
    if (!iso) return '';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const pill = (meta) => `<span class="pill" style="--c:${meta.color}">${esc(meta.label)}</span>`;

// ─── sign in ────────────────────────────────────────
function showLogin() {
    stopPolling();
    app.innerHTML = `
      <div class="login">
        <form id="login" class="card">
          <div class="logo">V</div>
          <h1>Virasat Homes</h1>
          <p class="muted">Admin · plots and customers</p>
          <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
          <button class="btn-primary" type="submit">Sign in</button>
          <p class="err" id="loginErr" hidden></p>
        </form>
      </div>`;
    $('#login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        try {
            await api('/admin/session', { method: 'POST', body: { password: e.target.password.value } });
            start();
        } catch (err) {
            $('#loginErr').textContent = err.message;
            $('#loginErr').hidden = false;
            btn.disabled = false;
        }
    });
    $('#login input').focus();
}

// ─── shell ─────────────────────────────────────────
const state = { tab: 'overview', plots: [], byId: new Map(), leads: [], summary: null, plotFilter: new Set(), plotQuery: '', leadFilter: null, leadQuery: '', selected: null };
let planView = null;
let pollTimer = null;
const stopPolling = () => { clearInterval(pollTimer); pollTimer = null; };

function shell() {
    app.innerHTML = `
      <header class="bar">
        <div class="brand"><span class="logo sm">V</span><b>Virasat Homes</b><span class="muted hide-sm">Admin</span></div>
        <nav class="tabs" role="tablist">
          <button role="tab" data-tab="overview">Overview</button>
          <button role="tab" data-tab="plots">Plots</button>
          <button role="tab" data-tab="customers">Customers <span class="badge" id="newBadge" hidden></span></button>
        </nav>
        <div class="bar-end">
          <a class="btn-link hide-sm" href="../" target="_blank" rel="noopener">Customer site ↗</a>
          <button class="btn-link" id="signout" type="button">Sign out</button>
        </div>
      </header>
      <main id="main"></main>`;
    app.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
    $('#signout').addEventListener('click', async () => { await api('/admin/session', { method: 'DELETE' }).catch(() => {}); showLogin(); });
}

function go(tab) {
    state.tab = tab;
    app.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    planView = null;
    if (tab === 'overview') renderOverview();
    if (tab === 'plots') renderPlots();
    if (tab === 'customers') renderLeads();
    history.replaceState(null, '', '#' + tab);
}

async function loadAll() {
    const [s, p, l] = await Promise.all([api('/admin/summary'), api('/admin/plots'), api('/admin/leads')]);
    state.summary = s;
    state.plots = p.plots.sort(plotSort);
    state.byId = new Map(state.plots.map(x => [x.id, x]));
    state.leads = l.leads;
    const n = s.leads.byStatus.new || 0;
    $('#newBadge').hidden = !n;
    $('#newBadge').textContent = n;
}

// ─── overview ──────────────────────────────────────
function chart(series) {
    const W = 600, H = 150, P = 22;
    const max = Math.max(4, ...series.map(d => Math.max(d.visitors, d.leads)));
    const bw = (W - P) / series.length;
    const bars = series.map((d, i) => {
        const x = P + i * bw;
        const hv = (d.visitors / max) * (H - 30);
        const hl = (d.leads / max) * (H - 30);
        const label = i % 2 === 0 || series.length < 8 ? `<text x="${x + bw / 2}" y="${H - 4}" class="ax">${d.day.slice(8)}</text>` : '';
        return `<g><title>${d.day}: ${d.visitors} visitors, ${d.leads} enquiries</title>
          <rect x="${x + 3}" y="${H - 18 - hv}" width="${bw / 2 - 3}" height="${hv}" rx="2" class="bv"/>
          <rect x="${x + bw / 2}" y="${H - 18 - hl}" width="${bw / 2 - 3}" height="${hl}" rx="2" class="bl"/>${label}</g>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Visitors and enquiries, last 14 days">
      <text x="0" y="12" class="ax">${max}</text><line x1="${P}" x2="${W}" y1="${H - 18}" y2="${H - 18}" class="axl"/>${bars}</svg>`;
}

function renderOverview() {
    const s = state.summary;
    const st = s.plots.byStatus;
    $('#main').innerHTML = `
      <section class="grid stats">
        ${STATUS_ORDER.map(k => `<button class="stat" data-status="${k}" style="--c:${STATUS[k].color}"><b>${st[k] || 0}</b><span>${STATUS[k].label}</span></button>`).join('')}
      </section>
      <section class="grid two">
        <div class="card">
          <h2>Stock</h2>
          <dl class="kv">
            <div><dt>Total plots</dt><dd>${s.plots.total}</dd></div>
            <div><dt>Available area</dt><dd>${fmtNum(s.plots.availableAreaSqYd)} sq yd</dd></div>
            <div><dt>Booked + sold area</dt><dd>${fmtNum(s.plots.soldAreaSqYd)} sq yd</dd></div>
            <div><dt>Booked + sold value</dt><dd>${s.plots.bookedValue ? fmtMoney(s.plots.bookedValue) : '—'}</dd></div>
          </dl>
        </div>
        <div class="card">
          <h2>Website</h2>
          <dl class="kv">
            <div><dt>Visitors today</dt><dd>${s.visitors.today}</dd></div>
            <div><dt>Visitors, 7 days</dt><dd>${s.visitors.last7}</dd></div>
            <div><dt>Visitors, 30 days</dt><dd>${s.visitors.last30}</dd></div>
            <div><dt>Enquiries (new / all)</dt><dd>${s.leads.byStatus.new || 0} / ${s.leads.total}</dd></div>
          </dl>
        </div>
      </section>
      <section class="card">
        <div class="row-between"><h2>Last 14 days</h2><span class="legend-inline"><i class="bv"></i>Visitors <i class="bl"></i>Enquiries</span></div>
        ${chart(s.series)}
      </section>
      <section class="grid two">
        <div class="card">
          <h2>Most viewed plots · 30 days</h2>
          ${s.topViewed.length ? `<ol class="list">${s.topViewed.map(t => `<li><button class="link" data-plot="${esc(t.id)}">Plot ${esc(t.id)}</button><span class="muted">${t.people} ${t.people === 1 ? 'person' : 'people'} · ${t.views} ${t.views === 1 ? 'view' : 'views'}</span>${pill(STATUS[state.byId.get(t.id)?.status || 'available'])}</li>`).join('')}</ol>` : '<p class="muted">No plot views yet. They appear here as customers open plots on the site.</p>'}
        </div>
        <div class="card">
          <h2>Latest enquiries</h2>
          ${s.recentLeads.length ? `<ol class="list">${s.recentLeads.map(l => `<li><button class="link" data-lead="${l.id}">${esc(l.name)}</button><span class="muted">${l.plotId ? 'Plot ' + esc(l.plotId) + ' · ' : ''}${ago(l.createdAt)}</span>${pill(STAGES[l.status])}</li>`).join('')}</ol>` : '<p class="muted">No enquiries yet. Share the customer site link to start getting them.</p>'}
        </div>
      </section>
      <p class="muted small">Customer site: <a href="../" target="_blank" rel="noopener">${location.origin}/virasat-homes/</a></p>`;
    $('#main').querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => { state.plotFilter = new Set([b.dataset.status]); go('plots'); }));
    $('#main').querySelectorAll('[data-plot]').forEach(b => b.addEventListener('click', () => { state.selected = b.dataset.plot; go('plots'); }));
    $('#main').querySelectorAll('[data-lead]').forEach(b => b.addEventListener('click', () => { state.leadQuery = ''; state.leadFilter = null; go('customers'); requestAnimationFrame(() => document.getElementById('lead-' + b.dataset.lead)?.scrollIntoView({ block: 'center' })); }));
}

// ─── plots ─────────────────────────────────────────
const plotMatches = (p) => {
    if (state.plotFilter.size && !state.plotFilter.has(p.status)) return false;
    const q = state.plotQuery.trim().toLowerCase();
    if (!q) return true;
    return p.id.toLowerCase() === q || p.id.toLowerCase().startsWith(q) || (p.customerName || '').toLowerCase().includes(q) || (p.customerPhone || '').includes(q);
};

function renderPlots() {
    $('#main').innerHTML = `
      <div class="plots">
        <div class="plan-pane card flush"><div id="plan"></div>
          <div class="plan-tools"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="fit" aria-label="Whole site">⤢</button></div>
        </div>
        <div class="list-pane">
          <div class="toolbar">
            <input id="pq" type="search" placeholder="Plot no., customer or mobile" value="${esc(state.plotQuery)}">
            <a class="btn" href="${API}/admin/export?kind=plots" download>Excel ⤓</a>
          </div>
          <div class="chips" id="pchips"></div>
          <div id="plist" class="plist"></div>
        </div>
      </div>
      <aside id="editor" class="editor" hidden></aside>`;
    planView = createPlanView($('#plan'), {
        fillOf: ({ id }) => { const p = state.byId.get(id); return !p ? '#ccc' : plotMatches(p) ? STATUS[p.status].color : '#dadce0'; },
        onSelect: (id) => openPlot(id),
    });
    $('.plan-tools').addEventListener('click', (e) => {
        const z = e.target.dataset.z;
        if (z === 'in') planView.zoomIn();
        if (z === 'out') planView.zoomOut();
        if (z === 'fit') planView.reset();
    });
    $('#pq').addEventListener('input', (e) => {
        state.plotQuery = e.target.value;
        drawPlots();
        const hit = findPlot(state.plotQuery);
        if (hit) planView.focus(hit.id, 3);
    });
    drawPlots();
    if (state.selected) openPlot(state.selected);
}

function drawPlots() {
    const counts = Object.fromEntries(STATUS_ORDER.map(s => [s, 0]));
    state.plots.forEach(p => { counts[p.status]++; });
    $('#pchips').innerHTML = STATUS_ORDER.map(s => `<button class="chip${state.plotFilter.has(s) ? ' on' : ''}" data-s="${s}"><i style="background:${STATUS[s].color}"></i>${STATUS[s].label} <b>${counts[s]}</b></button>`).join('') +
        (state.plotFilter.size ? '<button class="chip clear" data-s="">Show all</button>' : '');
    $('#pchips').onclick = (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        if (!b.dataset.s) state.plotFilter.clear();
        else if (state.plotFilter.has(b.dataset.s)) state.plotFilter.delete(b.dataset.s);
        else state.plotFilter.add(b.dataset.s);
        drawPlots();
    };
    const rows = state.plots.filter(plotMatches);
    $('#plist').innerHTML = rows.length ? rows.map(p => {
        const L = layoutById.get(p.id);
        const total = p.pricePerSqYd ? fmtMoney(p.pricePerSqYd * L.areaSqYd) : '';
        return `<button class="prow${p.id === state.selected ? ' sel' : ''}" data-id="${esc(p.id)}">
          <b class="pid">${esc(p.id)}</b>
          <span class="pmeta">${fmtNum(L.areaSqYd, 2)} sq yd${L.dims ? ' · ' + esc(L.dims.label) : ''}<small>${esc(p.customerName || '')}${p.customerName && total ? ' · ' : ''}${total}${p.people ? `${p.customerName || total ? ' · ' : ''}${p.people} viewed` : ''}</small></span>
          ${pill(STATUS[p.status])}
        </button>`;
    }).join('') : '<p class="muted pad">No plots match.</p>';
    $('#plist').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openPlot(b.dataset.id, true); };
    planView?.update();
}

function openPlot(id, focus = false) {
    const ed = $('#editor');
    if (!id) { state.selected = null; planView?.select(null); if (ed) ed.hidden = true; drawPlots(); return; }
    const p = state.byId.get(id);
    const L = layoutById.get(id);
    if (!p || !L) return;
    state.selected = id;
    planView?.select(id);
    if (focus) planView?.focus(id, 3);
    $('#plist').querySelectorAll('.prow').forEach(r => r.classList.toggle('sel', r.dataset.id === id));
    const holdLocal = p.holdUntil ? new Date(Date.parse(p.holdUntil) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    ed.hidden = false;
    ed.innerHTML = `
      <div class="ed-head"><h2>Plot ${esc(id)}</h2><button class="x" type="button" aria-label="Close">×</button></div>
      <p class="muted">${fmtNum(L.areaSqYd, 2)} sq yd (${fmtNum(L.areaSqFt)} sq ft) · ${L.dims ? esc(L.dims.label) : 'irregular'} · ${esc(L.facing.map(f => f.dir + ' ' + f.roadFt + ' ft road').join(', '))}</p>
      <form id="pform">
        <label class="lbl">Status</label>
        <div class="status-pick">${STATUS_ORDER.map(s => `<label style="--c:${STATUS[s].color}"><input type="radio" name="status" value="${s}"${p.status === s ? ' checked' : ''}><span>${STATUS[s].label}</span></label>`).join('')}</div>
        <div class="hold-row"${p.status === 'hold' ? '' : ' hidden'}>
          <label class="lbl" for="holdUntil">Hold until</label>
          <div class="row"><input id="holdUntil" name="holdUntil" type="datetime-local" value="${holdLocal}">
          <button type="button" class="btn sm" data-hold="1">1 day</button><button type="button" class="btn sm" data-hold="3">3 days</button><button type="button" class="btn sm" data-hold="7">1 week</button></div>
          <p class="muted small">The plot turns available again by itself when the hold ends.</p>
        </div>
        <label class="lbl" for="price">Price per sq yd (₹)</label>
        <input id="price" name="pricePerSqYd" type="number" inputmode="numeric" min="0" step="1" value="${p.pricePerSqYd ?? ''}" placeholder="e.g. 14500">
        <p class="muted small" id="totalLine">${p.pricePerSqYd ? 'Total ' + fmtMoney(p.pricePerSqYd * L.areaSqYd) : 'Customers see “Price on request” until you add a price.'}</p>
        <div class="row2">
          <div><label class="lbl" for="cn">Customer name</label><input id="cn" name="customerName" value="${esc(p.customerName || '')}" maxlength="60"></div>
          <div><label class="lbl" for="cp">Customer mobile</label><input id="cp" name="customerPhone" type="tel" inputmode="numeric" value="${esc(p.customerPhone || '')}" maxlength="14"></div>
        </div>
        <label class="lbl" for="note">Note</label>
        <textarea id="note" name="note" rows="2" maxlength="300">${esc(p.note || '')}</textarea>
        <button class="btn-primary" type="submit">Save</button>
        <p class="muted small">${p.version ? `Last change: ${p.updatedBy ? esc(p.updatedBy) + ', ' : ''}${ago(p.updatedAt)}` : 'Not changed yet'}${p.people ? ` · viewed by ${p.people} ${p.people === 1 ? 'person' : 'people'} in 30 days` : ''}${p.leads ? ` · ${p.leads} ${p.leads === 1 ? 'enquiry' : 'enquiries'}` : ''}</p>
      </form>
      <details id="hist"><summary>History</summary><div class="hist-body muted">Loading…</div></details>`;
    ed.querySelector('.x').onclick = () => openPlot(null);
    const form = $('#pform');
    form.addEventListener('change', (e) => {
        if (e.target.name === 'status') form.querySelector('.hold-row').hidden = e.target.value !== 'hold';
    });
    form.price.addEventListener('input', () => {
        const v = Number(form.price.value);
        $('#totalLine').textContent = v ? 'Total ' + fmtMoney(v * L.areaSqYd) : 'Customers see “Price on request” until you add a price.';
    });
    form.querySelectorAll('[data-hold]').forEach(b => b.addEventListener('click', () => {
        const t = new Date(Date.now() + Number(b.dataset.hold) * 86400000 - new Date().getTimezoneOffset() * 60000);
        form.holdUntil.value = t.toISOString().slice(0, 16);
    }));
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const status = fd.get('status');
        const body = {
            id, version: p.version, status,
            pricePerSqYd: fd.get('pricePerSqYd') === '' ? null : Number(fd.get('pricePerSqYd')),
            customerName: fd.get('customerName'), customerPhone: fd.get('customerPhone'), note: fd.get('note'),
            holdUntil: status === 'hold' && fd.get('holdUntil') ? new Date(fd.get('holdUntil')).toISOString() : null,
        };
        if (status === 'hold' && !body.holdUntil) delete body.holdUntil; // server sets 2 days
        const btn = form.querySelector('.btn-primary');
        btn.disabled = true;
        try {
            const { plot } = await api('/admin/plots', { method: 'PATCH', body });
            Object.assign(p, plot);
            toast(`Plot ${id} saved`);
            drawPlots();
            openPlot(id);
        } catch (err) {
            toast(err.message);
            if (err.status === 409 && err.data?.plot) { Object.assign(p, err.data.plot); drawPlots(); openPlot(id); }
            else btn.disabled = false;
        }
    });
    $('#hist').addEventListener('toggle', async (e) => {
        if (!e.target.open) return;
        try {
            const { history } = await api('/admin/plots?history=' + encodeURIComponent(id));
            e.target.querySelector('.hist-body').innerHTML = history.length ? `<ul class="hist">${history.map(h => `<li><b>${ago(h.at)}</b> · ${esc(h.actor || '')}: ${esc(Object.entries(h.detail || {}).map(([k, v]) => `${k} → ${v ?? '—'}`).join(', '))}</li>`).join('')}</ul>` : 'No changes yet.';
        } catch (err) { e.target.querySelector('.hist-body').textContent = err.message; }
    });
}

// ─── customers ─────────────────────────────────────
function leadMatches(l) {
    if (state.leadFilter && l.status !== state.leadFilter) return false;
    const q = state.leadQuery.trim().toLowerCase();
    return !q || l.name.toLowerCase().includes(q) || l.phone.includes(q) || (l.plotId || '').toLowerCase() === q;
}

function renderLeads() {
    $('#main').innerHTML = `
      <div class="toolbar">
        <input id="lq" type="search" placeholder="Name, mobile or plot" value="${esc(state.leadQuery)}">
        <a class="btn" href="${API}/admin/export?kind=leads" download>Excel ⤓</a>
      </div>
      <div class="chips" id="lchips"></div>
      <div id="llist" class="llist"></div>`;
    $('#lq').addEventListener('input', (e) => { state.leadQuery = e.target.value; drawLeads(); });
    drawLeads();
}

function drawLeads() {
    const counts = Object.fromEntries(Object.keys(STAGES).map(s => [s, 0]));
    state.leads.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    $('#lchips').innerHTML = `<button class="chip${!state.leadFilter ? ' on' : ''}" data-s="">All <b>${state.leads.length}</b></button>` +
        Object.entries(STAGES).map(([k, v]) => `<button class="chip${state.leadFilter === k ? ' on' : ''}" data-s="${k}"><i style="background:${v.color}"></i>${v.label} <b>${counts[k]}</b></button>`).join('');
    $('#lchips').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { state.leadFilter = b.dataset.s || null; drawLeads(); } };
    const rows = state.leads.filter(leadMatches);
    $('#llist').innerHTML = rows.length ? rows.map(l => `
      <article class="card lead" id="lead-${l.id}">
        <div class="row-between">
          <div><h3>${esc(l.name)}</h3><span class="muted small">${ago(l.createdAt)} · from ${esc(l.source)}${l.enquiries > 1 ? ` · asked ${l.enquiries} times` : ''}</span></div>
          ${pill(STAGES[l.status] || STAGES.new)}
        </div>
        <div class="contact">
          <a class="btn" href="tel:+91${esc(l.phone)}">Call ${esc(l.phone)}</a>
          <a class="btn" href="https://wa.me/91${esc(l.phone)}?text=${encodeURIComponent(`Namaste ${l.name}, thank you for your interest in Virasat Homes${l.plotId ? ' (Plot ' + l.plotId + ')' : ''}.`)}" target="_blank" rel="noopener">WhatsApp</a>
          ${l.plotId ? `<button class="btn" data-goplot="${esc(l.plotId)}">Plot ${esc(l.plotId)}</button>` : ''}
        </div>
        ${l.message ? `<p class="msg">“${esc(l.message)}”</p>` : ''}
        <form class="lform" data-id="${l.id}">
          <div class="row2">
            <div><label class="lbl">Stage</label><select name="status">${Object.entries(STAGES).map(([k, v]) => `<option value="${k}"${l.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></div>
            <div><label class="lbl">Call back on</label><input type="date" name="followUp" value="${l.followUp || ''}"></div>
          </div>
          <label class="lbl">Notes</label>
          <textarea name="notes" rows="2" maxlength="1000">${esc(l.notes || '')}</textarea>
          <div class="row-between"><button class="btn-primary sm" type="submit">Save</button><button class="btn-link danger" type="button" data-del="${l.id}">Delete</button></div>
        </form>
      </article>`).join('') : `<p class="muted pad">${state.leads.length ? 'No customers match.' : 'No enquiries yet. They arrive here when customers tap “Request a call back” on the site.'}</p>`;
    $('#llist').onclick = async (e) => {
        const gp = e.target.closest('[data-goplot]');
        if (gp) { state.selected = gp.dataset.goplot; state.plotFilter.clear(); state.plotQuery = ''; return go('plots'); }
        const del = e.target.closest('[data-del]');
        if (del) {
            const l = state.leads.find(x => x.id === Number(del.dataset.del));
            if (!confirm(`Delete ${l.name}? This cannot be undone.`)) return;
            try {
                await api('/admin/leads?id=' + l.id, { method: 'DELETE' });
                state.leads = state.leads.filter(x => x.id !== l.id);
                toast('Deleted');
                drawLeads();
            } catch (err) { toast(err.message); }
        }
    };
    $('#llist').querySelectorAll('.lform').forEach(f => f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = Number(f.dataset.id);
        const fd = new FormData(f);
        try {
            const { lead } = await api('/admin/leads', { method: 'PATCH', body: { id, status: fd.get('status'), followUp: fd.get('followUp') || null, notes: fd.get('notes') } });
            Object.assign(state.leads.find(x => x.id === id), lead);
            toast(`${lead.name} saved`);
            drawLeads();
        } catch (err) { toast(err.message); }
    }));
}

// ─── start ─────────────────────────────────────────
async function start() {
    shell();
    $('#main').innerHTML = '<p class="muted pad">Loading…</p>';
    try {
        await loadAll();
    } catch (err) {
        if (err.message !== 'Please sign in again') $('#main').innerHTML = `<p class="err pad">${esc(err.message)}</p>`;
        return;
    }
    const tab = ['overview', 'plots', 'customers'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    go(tab);
    stopPolling();
    pollTimer = setInterval(async () => {
        if (document.visibilityState !== 'visible' || document.activeElement?.closest('form')) return;
        try {
            await loadAll();
            if (state.tab === 'overview') renderOverview();
            else if (state.tab === 'customers') drawLeads();
            else if (state.tab === 'plots') drawPlots();
        } catch { /* keep current view */ }
    }, 60000);
}

api('/admin/session').then(s => (s.authed ? start() : showLogin())).catch(() => showLogin());
