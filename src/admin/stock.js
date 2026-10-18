// Stock (inventory) tab of the builder dashboard: which plot is free, on hold, booked or sold —
// changed with big buttons on a phone, shared on WhatsApp, imported/exported as Excel (CSV).
import { SITE, plots, plotById, features, boundary } from '../shared/site.js';
import { SERVER_TO_TOKEN, TOKEN_TO_SERVER, STATUS_COLORS, STATUS_LABEL } from '../shared/status.js';
import { t, getLang, locale } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Number(n || 0).toLocaleString(locale());
const SERVER_STATUSES = ['available', 'hold', 'booked', 'sold', 'blocked'];
const HOLD_OPTIONS = [[24, 'hold24'], [48, 'hold48'], [72, 'hold72'], [168, 'hold7d']];
const label = (serverStatus) => STATUS_LABEL[getLang()][SERVER_TO_TOKEN[serverStatus]] || serverStatus;

export function createStock({ api, toast }) {
    const data = { units: new Map(), demand: {}, changes: [], days: 7, loadedAt: 0 };
    const ui = { filter: 'all', search: '', shown: 30, ask: null, asking: false, broker: '' };
    let current = null; // unit being edited in the dialog
    let onChange = () => {};

    // ─── Data ────────────────────────────────────────
    async function load(days = 7) {
        const r = await api(`/api/admin/inventory?days=${days}`);
        data.units = new Map(r.units.map(u => [u.id, u]));
        data.demand = r.demand;
        data.changes = r.changes;
        data.days = r.days;
        data.loadedAt = Date.now();
    }

    // Every plot on the plan, merged with the saved override (if any) and recent demand
    function rows() {
        return plots.map(p => {
            const u = data.units.get(p.id);
            const d = data.demand[p.id] || { views: 0, enquiries: 0, people: 0, holds: 0, tier: 'normal' };
            const status = u?.status || TOKEN_TO_SERVER[p.status] || 'available';
            return {
                id: p.id, plot: p, status, token: SERVER_TO_TOKEN[status],
                priceLakh: u?.price_lakh ?? (p.priceLakh || null),
                priceFromPlan: !u || u.price_lakh == null,
                holdUntil: u?.hold_until || null,
                customerName: u?.customer_name || '', customerPhone: u?.customer_phone || '', broker: u?.broker || '',
                note: u?.note || '', version: u?.version ?? null, updatedAt: u?.updated_at || null, updatedBy: u?.updated_by || null,
                demand: d, hot: d.tier === 'hot',
                areaSqFt: p.areaSqFt, gaj: p.gaj, facing: p.facing.map(f => f.dir), zone: p.zone, corner: p.facing.length > 1,
            };
        });
    }

    function counts(list = rows()) {
        const c = { all: list.length, available: 0, hold: 0, booked: 0, sold: 0, blocked: 0, hot: 0 };
        list.forEach(r => { c[r.status] += 1; if (r.hot && r.status === 'available') c.hot += 1; });
        return c;
    }

    const hoursLeft = (iso) => (Date.parse(iso) - Date.now()) / 36e5;

    // Facts the morning note is written from (also used for alerts)
    function facts() {
        const list = rows();
        const c = counts(list);
        const holdsEnding = list.filter(r => r.status === 'hold' && r.holdUntil && hoursLeft(r.holdUntil) <= 24).map(r => r.id);
        const hot = list.filter(r => r.hot && r.status === 'available').sort((a, b) => b.demand.enquiries - a.demand.enquiries || b.demand.views - a.demand.views).map(r => r.id);
        const noPrice = list.filter(r => r.status === 'available' && !r.priceLakh).map(r => r.id);
        const avail = list.filter(r => r.status === 'available');
        const priced = avail.filter(r => r.priceLakh).map(r => r.priceLakh);
        return { available: c.available, hold: c.hold, booked: c.booked, sold: c.sold, blocked: c.blocked, holdsEnding, hot, noPrice,
            minPriceLakh: priced.length ? Math.min(...priced) : null, cornerAvailable: avail.filter(r => r.corner).length,
            sizesGaj: [...new Set(avail.map(r => Math.round(r.gaj)))].sort((a, b) => a - b).slice(0, 5),
            soldThisWeek: data.changes.filter(ch => ['booked', 'sold'].includes(ch.to_status) && Date.now() - Date.parse(ch.created_at) < 7 * 864e5).length };
    }

    // ─── Render ──────────────────────────────────────
    function render(el) {
        const list = rows();
        const c = counts(list);
        const f = facts();
        const alerts = [];
        if (f.holdsEnding.length) alerts.push({ tone: 'yellow', text: t('alertHolds', { n: f.holdsEnding.length, plots: f.holdsEnding.slice(0, 4).join(', ') }), filter: 'hold' });
        if (f.hot.length) alerts.push({ tone: 'red', text: t('alertHot', { n: f.hot.length, plots: f.hot.slice(0, 3).join(', ') }), filter: 'hot' });
        if (f.noPrice.length) alerts.push({ tone: 'blue', text: t('alertNoPrice', { n: f.noPrice.length }), filter: 'noprice' });

        el.innerHTML = `
        <section class="tiles">
            ${['available', 'hold', 'booked', 'sold'].map(s => `
            <button type="button" class="tile st-${s}${ui.filter === s ? ' is-active' : ''}" data-stock-filter="${s}">
                <b>${fmt(c[s])}</b><span>${label(s)}</span>
            </button>`).join('')}
        </section>
        ${alerts.length ? `<section class="alerts">${alerts.map(a => `<button type="button" class="alert tone-${a.tone}" data-stock-filter="${a.filter}">${a.text}</button>`).join('')}</section>` : ''}
        <section class="card">
            <h2>${t('askTitle')}</h2><p class="help">${t('askHelp')}</p>
            <form class="ask" id="ask-form">
                <input type="text" id="ask-input" maxlength="300" placeholder="${esc(t('askPlaceholder'))}" autocomplete="off">
                <button class="btn btn-primary" type="submit" ${ui.asking ? 'disabled' : ''}>${ui.asking ? '…' : t('askGo')}</button>
            </form>
            <div class="chips scroll" id="ask-examples">${t('askExamples').split('|').map(x => `<button type="button" class="chip" data-ask="${esc(x)}">${esc(x)}</button>`).join('')}</div>
            ${ui.ask ? `<div class="ask-answer">
                <p>${esc(ui.ask.answer)}${ui.ask.ai === false ? ` <span class="muted">(${t('askBasic')})</span>` : ''}</p>
                <div class="chips">${ui.ask.unitIds.slice(0, 40).map(id => `<button type="button" class="chip" data-unit="${esc(id)}">${esc(id)}</button>`).join('') || ''}</div>
            </div>` : ''}
        </section>
        <section class="card" id="stock-plan-card">
            <h2>${t('stockPlanTitle')}</h2><p class="help">${t('stockPlanHelp')}</p>
            <div class="plan" id="stock-plan"></div>
        </section>
        <section class="card">
            <h2>${t('shareTitle')}</h2><p class="help">${t('shareHelp')}</p>
            <div class="share-row">
                <input type="text" id="share-broker" maxlength="40" placeholder="${esc(t('brokerName'))}" value="${esc(ui.broker)}">
                <a class="btn btn-tonal" id="share-wa" href="#" target="_blank" rel="noopener">${t('shareWhatsApp')}</a>
                <button type="button" class="btn btn-outline" data-stock-act="copy-link">${t('copyLink')}</button>
            </div>
            <pre class="share-preview" id="share-preview"></pre>
        </section>
        <section class="card" id="stock-list-card">
            <div class="card-head">
                <h2>${t('allPlots')} <span class="count">${fmt(list.length)}</span></h2>
                <div class="head-actions">
                    <button type="button" class="btn btn-outline btn-sm" data-stock-act="export">${t('exportExcel')}</button>
                    <label class="btn btn-outline btn-sm">${t('importExcel')}<input type="file" id="stock-file" accept=".csv,text/csv" hidden></label>
                </div>
            </div>
            <label class="search">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <input type="search" id="stock-search" placeholder="${esc(t('stockSearch'))}" value="${esc(ui.search)}">
            </label>
            <div class="chips scroll" id="stock-chips"></div>
            <ul class="stock-list" id="stock-list"></ul>
        </section>`;

        drawStatusPlan($('stock-plan'), list);
        renderList();
        updateShare();
    }

    function filtered(list = rows()) {
        const q = ui.search.trim().toLowerCase();
        return list.filter(r => {
            if (ui.filter === 'hot' ? !(r.hot && r.status === 'available') : ui.filter === 'noprice' ? !(r.status === 'available' && !r.priceLakh)
                : ui.filter !== 'all' && r.status !== ui.filter) return false;
            if (!q) return true;
            return r.id.toLowerCase().includes(q) || r.customerName.toLowerCase().includes(q) || r.customerPhone.includes(q) || r.broker.toLowerCase().includes(q)
                || (r.zone && `zone ${r.zone}`.toLowerCase() === q);
        });
    }

    function renderList() {
        const all = rows();
        const c = counts(all);
        $('stock-chips').innerHTML = ['all', 'available', 'hot', 'hold', 'booked', 'sold', 'blocked'].map(s =>
            `<button type="button" class="chip${ui.filter === s ? ' is-active' : ''}" data-stock-filter="${s}">${s === 'all' ? t('all') : s === 'hot' ? `🔥 ${t('inDemand')}` : `<i class="dot st-${s}"></i>${label(s)}`}<small>${c[s]}</small></button>`).join('');
        const list = filtered(all);
        $('stock-list').innerHTML = list.length ? list.slice(0, ui.shown).map(r => `<li>
            <button type="button" class="stock-row" data-unit="${esc(r.id)}">
                <span class="stock-id st-${r.status}">${esc(r.id)}</span>
                <span class="who-text">
                    <b>${fmt(r.areaSqFt)} sq.ft · ${r.gaj} gaj${r.facing.length ? ` · ${r.facing.join('/')}` : ''}${r.corner ? ` · ${t('corner')}` : ''}</b>
                    <span>${r.priceLakh ? `₹${r.priceLakh} L` : `<span class="late">${t('noPrice')}</span>`}
                        ${r.status === 'hold' && r.holdUntil ? ` · ⏳ ${holdLeft(r.holdUntil)}` : ''}
                        ${r.customerName ? ` · ${esc(r.customerName)}` : ''}${r.broker ? ` · ${t('viaBroker', { name: esc(r.broker) })}` : ''}</span>
                    <span class="small">${r.hot && r.status === 'available' ? '🔥 ' : ''}${t('looksWeek', { n: r.demand.views, e: r.demand.enquiries })}</span>
                </span>
                <span class="stage st-${r.status}">${label(r.status)}</span>
            </button>
        </li>`).join('') + (list.length > ui.shown ? `<li class="show-more"><button type="button" class="btn btn-outline" data-stock-act="more">${t('showMore', { n: fmt(list.length - ui.shown) })}</button></li>` : '')
            : `<li class="help none">${t('noPlotsHere')}</li>`;
    }

    function holdLeft(iso) {
        const h = hoursLeft(iso);
        if (h <= 0) return t('holdOver');
        if (h < 1) return t('holdMin', { n: Math.max(1, Math.round(h * 60)) });
        if (h < 48) return t('holdHrs', { n: Math.round(h) });
        return t('holdDays', { n: Math.round(h / 24) });
    }

    // Site plan coloured by status; tap a plot to change it
    function drawStatusPlan(el, list) {
        const by = new Map(list.map(r => [r.id, r]));
        const framed = features.filter(f => f.kind === 'plot' || f.kind === 'road');
        const b = framed.reduce((r, f) => ({
            minX: Math.min(r.minX, f.box.minX), minY: Math.min(r.minY, f.box.minY),
            maxX: Math.max(r.maxX, f.box.maxX), maxY: Math.max(r.maxY, f.box.maxY),
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
        const poly = (pts) => pts.map(p => p.join(',')).join(' ');
        const FILL = { available: '#81c995', hold: '#fdd663', booked: '#f5a97f', sold: '#dadce0', blocked: '#bdc1c6' };
        el.innerHTML = `<svg viewBox="${b.minX - 8} ${b.minY - 8} ${b.maxX - b.minX + 16} ${b.maxY - b.minY + 16}" role="img" aria-label="${esc(t('stockPlanTitle'))}">
            <polygon points="${poly(boundary.points)}" class="pl-boundary"/>
            ${features.filter(f => f.kind === 'common').map(f => `<polygon points="${poly(f.points)}" class="pl-green"/>`).join('')}
            ${features.filter(f => f.kind === 'road').map(f => `<polygon points="${poly(f.points)}" class="pl-road"/>`).join('')}
            ${plots.map(p => {
                const r = by.get(p.id);
                return `<g class="pl-plot" data-unit="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.id)}: ${esc(label(r.status))}">
                    <polygon points="${poly(p.points)}" fill="${FILL[r.status]}"/>
                    ${r.hot && r.status === 'available' ? `<circle cx="${p.box.maxX - 5}" cy="${p.box.minY + 5}" r="3.2" fill="#d93025"/>` : ''}
                    <text x="${p.center[0]}" y="${p.center[1]}">${esc(p.id)}</text>
                </g>`;
            }).join('')}
        </svg>
        <div class="legend">${['available', 'hold', 'booked', 'sold', 'blocked'].map(s => `<span><i style="background:${FILL[s]}"></i>${label(s)}</span>`).join('')}<span><i style="background:#d93025;border-radius:50%"></i>${t('inDemand')}</span></div>`;
    }

    // ─── WhatsApp share ──────────────────────────────
    function shareText() {
        const list = rows();
        const c = counts(list);
        const avail = list.filter(r => r.status === 'available');
        const byZone = {};
        avail.forEach(r => { if (r.zone) byZone[r.zone] = (byZone[r.zone] || 0) + 1; });
        const priced = avail.filter(r => r.priceLakh).map(r => r.priceLakh);
        const min = priced.length ? Math.min(...priced) : null;
        const corner = avail.filter(r => r.corner).length;
        const url = `${location.origin}/${ui.broker ? `?cp=${encodeURIComponent(ui.broker.trim())}` : ''}`;
        const date = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
        const hi = getLang() === 'hi';
        const lines = [
            `*${SITE.name}* — ${hi ? 'स्टॉक' : 'stock'} ${date}`,
            `✅ ${c.available} ${hi ? 'प्लॉट उपलब्ध' : 'plots available'}${Object.keys(byZone).length ? ` (${Object.entries(byZone).sort().map(([z, n]) => `Zone ${z}: ${n}`).join(', ')})` : ''}`,
            corner ? `📐 ${corner} ${hi ? 'कॉर्नर प्लॉट' : 'corner plots'}` : null,
            min ? `💰 ${hi ? 'शुरुआत' : 'starting'} ₹${min} ${hi ? 'लाख' : 'lakh'}` : null,
            `⏳ ${c.hold} ${hi ? 'होल्ड पर' : 'on hold'} · 🔒 ${c.booked} ${hi ? 'बुक' : 'booked'} · ${c.sold} ${hi ? 'बिक चुके' : 'sold'}`,
            `🗺️ ${hi ? 'लाइव मैप' : 'Live map'}: ${url}`,
            SITE.rera ? `RERA: ${SITE.rera}` : null,
        ].filter(Boolean);
        return lines.join('\n');
    }

    function updateShare() {
        const text = shareText();
        const pre = $('share-preview');
        if (!pre) return;
        pre.textContent = text;
        $('share-wa').href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    }

    // ─── Ask ─────────────────────────────────────────
    async function ask(question) {
        if (!question || ui.asking) return;
        ui.asking = true;
        onChange('rerender');
        try {
            const units = rows().map(r => ({ id: r.id, status: r.status, facing: r.facing, zone: r.zone, corner: r.corner, priceLakh: r.priceLakh, areaSqFt: r.areaSqFt, gaj: r.gaj, demand: r.demand.tier }));
            ui.ask = await api('/api/admin/ai', { method: 'POST', body: JSON.stringify({ task: 'ask', question, units, lang: getLang() }) });
            ui.ask.question = question;
        } catch (err) { toast(err.message); } finally {
            ui.asking = false;
            onChange('rerender');
            $('ask-input') && ($('ask-input').value = question);
        }
    }

    // ─── Unit dialog ─────────────────────────────────
    const dialog = () => $('unit');

    async function openUnit(id) {
        const r = rows().find(x => x.id === id);
        if (!r) return;
        current = { id, status: r.status, holdHours: 48, priceLakh: r.priceLakh ?? '', customerName: r.customerName, customerPhone: r.customerPhone, broker: r.broker, note: r.note, version: r.version, original: r.status };
        renderUnit(r);
        dialog().showModal();
        try {
            const { history } = await api(`/api/admin/inventory?id=${encodeURIComponent(id)}`);
            const ul = $('unit-history');
            if (!ul) return;
            ul.innerHTML = history.slice(0, 10).map(h => `<li><span class="tl-dot" aria-hidden="true"></span>
                <span>${h.from_status && h.from_status !== h.to_status ? `${label(h.from_status)} → ` : ''}<b>${label(h.to_status)}</b>${h.customer_name ? ` · ${esc(h.customer_name)}` : ''}${h.price_lakh ? ` · ₹${h.price_lakh} L` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</span>
                <small>${esc(h.actor || '')} · ${new Date(h.created_at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></li>`).join('')
                || `<li class="help">${t('noHistory')}</li>`;
        } catch { /* history is optional */ }
    }

    function renderUnit(r) {
        const p = r.plot;
        const needsCustomer = ['hold', 'booked', 'sold'].includes(current.status);
        $('unit-body').innerHTML = `
            <header class="sheet-head">
                <span class="avatar lg st-${current.status}" aria-hidden="true">${esc(p.id)}</span>
                <div class="who-text"><h2>${t('plot', { id: esc(p.id) })}</h2>
                    <span>${fmt(p.areaSqFt)} sq.ft · ${p.gaj} gaj${p.facing.length ? ` · ${p.facing.map(f => f.dir).join('/')}` : ''}${p.zone ? ` · Zone ${p.zone}` : ''}</span>
                    <span class="small">${r.hot ? '🔥 ' : ''}${t('looksWeek', { n: r.demand.views, e: r.demand.enquiries })}</span></div>
                <button type="button" class="btn btn-ghost icon-only" data-unit-act="close" aria-label="${esc(t('close'))}">
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
            </header>
            <section><h3>${t('status')}</h3>
                <div class="stage-grid status-grid">${SERVER_STATUSES.map(s => `<button type="button" class="stage-btn st-${s}${s === current.status ? ' is-active' : ''}" data-set-status="${s}" aria-pressed="${s === current.status}"><i class="dot st-${s}"></i>${label(s)}</button>`).join('')}</div>
            </section>
            ${current.status === 'hold' ? `<section><h3>${t('holdFor')}</h3>
                <div class="chips" id="hold-chips">${HOLD_OPTIONS.map(([h, k]) => `<button type="button" class="chip${current.holdHours === h ? ' is-active' : ''}" data-hold="${h}">${t(k)}</button>`).join('')}</div>
                ${r.status === 'hold' && r.holdUntil ? `<p class="help">${t('holdNow', { left: holdLeft(r.holdUntil) })}</p>` : ''}
            </section>` : ''}
            ${needsCustomer ? `<section><h3>${t('customerDetails')}</h3>
                <div class="two">
                    <label class="field"><span>${t('customerName')}</span><input id="u-name" maxlength="60" value="${esc(current.customerName)}" placeholder="${esc(t('optional'))}"></label>
                    <label class="field"><span>${t('customerMobile')}</span><input id="u-phone" type="tel" inputmode="numeric" maxlength="14" value="${esc(current.customerPhone)}" placeholder="98765 43210"></label>
                </div>
                <label class="field"><span>${t('brokerLabel')}</span><input id="u-broker" maxlength="60" value="${esc(current.broker)}" placeholder="${esc(t('optional'))}"></label>
                ${current.customerPhone && current.status !== 'hold' ? `<p class="help">${t('leadLinked')}</p>` : ''}
            </section>` : ''}
            <section><h3>${t('priceLakh')}</h3>
                <div class="price-row"><span class="prefix">₹</span><input id="u-price" type="number" inputmode="decimal" step="0.5" min="0" value="${esc(current.priceLakh)}" placeholder="${esc(p.priceLakh || '')}"><span class="suffix">${t('lakh')}</span></div>
                ${r.priceFromPlan && p.priceLakh ? `<p class="help">${t('priceFromPlan', { n: p.priceLakh })}</p>` : ''}
            </section>
            <section><h3>${t('notes')}</h3><textarea id="u-note" rows="2" maxlength="300" placeholder="${esc(t('unitNoteHint'))}">${esc(current.note)}</textarea></section>
            <section><h3>${t('unitHistory')}</h3><ul class="timeline" id="unit-history"><li class="help">…</li></ul></section>
            <footer class="sheet-foot">
                <a class="btn btn-outline" href="/#plot-${encodeURIComponent(p.id)}" target="_blank" rel="noopener">${t('openOnSite')}</a>
                <button type="button" class="btn btn-primary btn-lg" data-unit-act="save">${t('save')}</button>
            </footer>`;
    }

    function readForm() {
        current.customerName = $('u-name')?.value.trim() ?? current.customerName;
        current.customerPhone = $('u-phone')?.value.trim() ?? current.customerPhone;
        current.broker = $('u-broker')?.value.trim() ?? current.broker;
        current.priceLakh = $('u-price')?.value ?? current.priceLakh;
        current.note = $('u-note')?.value.trim() ?? current.note;
    }

    async function save(btn) {
        readForm();
        btn.disabled = true;
        try {
            const body = {
                id: current.id, version: current.version, status: current.status, holdHours: current.holdHours,
                priceLakh: current.priceLakh === '' ? null : current.priceLakh, note: current.note,
                customerName: current.customerName, customerPhone: current.customerPhone, broker: current.broker,
            };
            await api('/api/admin/inventory', { method: 'PATCH', body: JSON.stringify(body) });
            dialog().close();
            toast(t('stockSaved', { id: current.id, status: label(current.status) }));
            await onChange('saved');
        } catch (err) {
            toast(err.message);
            if (/changed by someone else/.test(err.message)) { dialog().close(); await onChange('saved'); }
        } finally { btn.disabled = false; }
    }

    // ─── Excel (CSV) ─────────────────────────────────
    const csvCell = (v) => {
        let s = String(v ?? '');
        if (/^[=@\t\r]/.test(s) || /^[+-](?!\d+$)/.test(s)) s = `'${s}`;
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    function exportCsv() {
        const head = ['Plot', 'Status', 'Price (lakh)', 'On hold till', 'Customer', 'Mobile', 'Broker', 'Note', 'Area (sq.ft)', 'Gaj', 'Facing', 'Zone', `Looks (${data.days}d)`, `Enquiries (${data.days}d)`];
        const lines = filtered().map(r => [r.id, STATUS_LABEL.en[r.token], r.priceLakh ?? '', r.holdUntil ? new Date(r.holdUntil).toLocaleString('en-IN') : '',
            r.customerName, r.customerPhone ? `+91${r.customerPhone}` : '', r.broker, r.note, r.areaSqFt, r.gaj, r.facing.join('/'), r.zone || '', r.demand.views, r.demand.enquiries]);
        const csv = '﻿' + [head, ...lines].map(l => l.map(csvCell).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `stock-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function parseCsv(text) {
        const out = [];
        let row = [], cell = '', q = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (q) {
                if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
            } else if (ch === '"') q = true;
            else if (ch === ',') { row.push(cell); cell = ''; }
            else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
            else cell += ch;
        }
        if (cell || row.length) { row.push(cell); out.push(row); }
        return out.filter(r => r.some(c => c.trim()));
    }

    async function importCsv(file) {
        const text = (await file.text()).replace(/^﻿/, '');
        const [head, ...lines] = parseCsv(text);
        const col = (names) => head.findIndex(h => names.includes(h.trim().toLowerCase().replace(/[^a-z ]/g, '').trim()));
        const iId = col(['plot', 'plot no', 'plot number', 'id', 'unit', 'flat']);
        const iStatus = col(['status', 'availability']);
        const iPrice = col(['price lakh', 'price', 'price in lakh', 'rate']);
        const iNote = col(['note', 'notes', 'remark', 'remarks']);
        if (iId < 0 || (iStatus < 0 && iPrice < 0)) return toast(t('importBadFile'));
        const LABEL_TO_SERVER = {};
        Object.entries(STATUS_LABEL.en).forEach(([tok, l]) => { LABEL_TO_SERVER[l.toLowerCase()] = TOKEN_TO_SERVER[tok]; });
        Object.entries(STATUS_LABEL.hi).forEach(([tok, l]) => { LABEL_TO_SERVER[l.toLowerCase()] = TOKEN_TO_SERVER[tok]; });
        const rowsOut = lines.map(l => ({
            id: (l[iId] || '').trim().replace(/^plot\s*/i, ''),
            status: iStatus >= 0 && l[iStatus]?.trim() ? (LABEL_TO_SERVER[l[iStatus].trim().toLowerCase()] || l[iStatus].trim()) : undefined,
            priceLakh: iPrice >= 0 && l[iPrice]?.trim() ? l[iPrice].trim() : undefined,
            note: iNote >= 0 && l[iNote]?.trim() ? l[iNote].trim() : undefined,
        })).filter(r => r.id && plotById.has(r.id));
        if (!rowsOut.length) return toast(t('importNoRows'));
        if (!confirm(t('importConfirm', { n: rowsOut.length }))) return;
        try {
            const { updated, errors } = await api('/api/admin/inventory', { method: 'POST', body: JSON.stringify({ rows: rowsOut }) });
            toast(t('importDone', { n: updated }) + (errors.length ? ` · ${errors[0]}` : ''));
            await onChange('saved');
        } catch (err) { toast(err.message); }
    }

    // ─── Events (delegated from the page + the dialog) ──
    function bind(root) {
        root.addEventListener('click', async (e) => {
            const f = e.target.closest('[data-stock-filter]');
            if (f) { ui.filter = ui.filter === f.dataset.stockFilter && f.classList.contains('tile') ? 'all' : f.dataset.stockFilter; ui.shown = 30; onChange('rerender'); $('stock-list-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
            const u = e.target.closest('[data-unit]');
            if (u) { openUnit(u.dataset.unit); return; }
            const a = e.target.closest('[data-ask]');
            if (a) { ask(a.dataset.ask); return; }
            const act = e.target.closest('[data-stock-act]');
            if (!act) return;
            switch (act.dataset.stockAct) {
                case 'export': exportCsv(); break;
                case 'more': ui.shown += 30; renderList(); break;
                case 'copy-link': {
                    const url = `${location.origin}/${ui.broker ? `?cp=${encodeURIComponent(ui.broker.trim())}` : ''}`;
                    try { await navigator.clipboard.writeText(url); toast(t('linkCopied')); } catch { prompt(t('copyLink'), url); }
                    break;
                }
            }
        });
        root.addEventListener('submit', (e) => {
            if (e.target.id !== 'ask-form') return;
            e.preventDefault();
            ask($('ask-input').value.trim());
        });
        root.addEventListener('input', (e) => {
            if (e.target.id === 'stock-search') { ui.search = e.target.value; ui.shown = 30; renderList(); }
            if (e.target.id === 'share-broker') { ui.broker = e.target.value; updateShare(); }
        });
        root.addEventListener('change', (e) => {
            if (e.target.id === 'stock-file' && e.target.files[0]) { importCsv(e.target.files[0]); e.target.value = ''; }
        });
        root.addEventListener('keydown', (e) => {
            const g = e.target.closest?.('.pl-plot[data-unit]');
            if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openUnit(g.dataset.unit); }
        });

        const d = dialog();
        d.addEventListener('click', (e) => {
            if (e.target === d) return d.close();
            const st = e.target.closest('[data-set-status]');
            if (st) { readForm(); current.status = st.dataset.setStatus; renderUnit(rows().find(x => x.id === current.id)); $('unit-history').innerHTML = ''; openHistoryAgain(); return; }
            const h = e.target.closest('[data-hold]');
            if (h) { current.holdHours = Number(h.dataset.hold); d.querySelectorAll('[data-hold]').forEach(b => b.classList.toggle('is-active', b === h)); return; }
            const act = e.target.closest('[data-unit-act]');
            if (act?.dataset.unitAct === 'close') d.close();
            if (act?.dataset.unitAct === 'save') save(act);
        });
    }
    async function openHistoryAgain() {
        try {
            const { history } = await api(`/api/admin/inventory?id=${encodeURIComponent(current.id)}`);
            const ul = $('unit-history');
            if (ul) ul.innerHTML = history.slice(0, 10).map(h => `<li><span class="tl-dot" aria-hidden="true"></span><span><b>${label(h.to_status)}</b>${h.customer_name ? ` · ${esc(h.customer_name)}` : ''}</span><small>${new Date(h.created_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</small></li>`).join('') || `<li class="help">${t('noHistory')}</li>`;
        } catch { /* optional */ }
    }

    return {
        load, render, bind, rows, counts, facts, openUnit, shareText,
        recentChanges: () => data.changes,
        set onChange(fn) { onChange = fn; },
        get loadedAt() { return data.loadedAt; },
        statusLabel: label,
    };
}

export { STATUS_COLORS };
