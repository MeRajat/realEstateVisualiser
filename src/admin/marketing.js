// Marketing tab: connect Facebook / Instagram lead ads and WhatsApp, see what each campaign
// brought (visitors → leads → site visits → bookings, and what it cost), make campaign links,
// write ad copy with AI, and try the WhatsApp assistant.
import { SITE } from '../shared/site.js';
import { t, getLang, locale, sourceName } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Number(n || 0).toLocaleString(locale());
const money = (n) => `₹${fmt(Math.round(n))}`;
const SOURCES = ['facebook', 'instagram', 'whatsapp', 'google', 'youtube', '99acres', 'magicbricks', 'other'];
const TEST_PHONE = '9999900000';

export function createMarketing({ api, toast, stockFacts, openCustomer }) {
    const data = { days: 30, campaigns: [], spend: [], waThreads: [], setup: null, loadedAt: 0 };
    const ui = { link: { source: 'facebook', campaign: '' }, ad: null, adLoading: false, chat: [], chatBusy: false, spendOpen: false };
    let onChange = () => {};

    async function load(days = data.days) {
        const r = await api(`/api/admin/marketing?days=${days}`);
        Object.assign(data, r, { loadedAt: Date.now() });
    }

    // ─── Derived: campaign rows with spend + unit costs ───
    function rows() {
        const spendBy = {};
        data.spend.forEach(s => { const k = `${s.source}|${s.campaign || ''}`; spendBy[k] = (spendBy[k] || 0) + s.amount; });
        const seen = new Set();
        const out = data.campaigns.map(c => {
            const k = `${c.source}|${c.campaign || ''}`;
            seen.add(k);
            return { ...c, spend: spendBy[k] || 0 };
        });
        Object.entries(spendBy).forEach(([k, amount]) => {
            if (seen.has(k)) return;
            const [source, campaign] = k.split('|');
            out.push({ source, campaign: campaign || null, visitors: 0, leads: 0, site_visits: 0, booked: 0, spend: amount });
        });
        return out.sort((a, b) => b.leads - a.leads || b.spend - a.spend || b.visitors - a.visitors);
    }

    function render(el) {
        const list = rows();
        const totals = list.reduce((a, r) => ({ visitors: a.visitors + r.visitors, leads: a.leads + r.leads, site_visits: a.site_visits + r.site_visits, booked: a.booked + r.booked, spend: a.spend + r.spend }), { visitors: 0, leads: 0, site_visits: 0, booked: 0, spend: 0 });
        const s = data.setup || {};
        el.innerHTML = `
        <section class="card">
            <div class="card-head"><div><h2>${t('mkResultsTitle')}</h2><p class="help">${t('mkResultsHelp')}</p></div>
                <div class="tabs" role="tablist">${[30, 90].map(d => `<button type="button" role="tab" class="${data.days === d ? 'is-active' : ''}" data-mk-days="${d}">${t(`tab${d}`)}</button>`).join('')}</div></div>
            <div class="kpis small">
                <div class="kpi"><span class="kpi-label">${t('mkSpend')}</span><b class="kpi-value">${money(totals.spend)}</b></div>
                <div class="kpi"><span class="kpi-label">${t('kLeads')}</span><b class="kpi-value">${fmt(totals.leads)}</b><div class="kpi-delta">${totals.leads && totals.spend ? t('perLead', { n: money(totals.spend / totals.leads) }) : ''}</div></div>
                <div class="kpi"><span class="kpi-label">${t('kVisits')}</span><b class="kpi-value">${fmt(totals.site_visits)}</b><div class="kpi-delta">${totals.site_visits && totals.spend ? t('perVisit', { n: money(totals.spend / totals.site_visits) }) : ''}</div></div>
                <div class="kpi"><span class="kpi-label">${t('kBooked')}</span><b class="kpi-value">${fmt(totals.booked)}</b><div class="kpi-delta">${totals.booked && totals.spend ? t('perBooking', { n: money(totals.spend / totals.booked) }) : ''}</div></div>
            </div>
            ${list.length ? `<div class="table-wrap"><table class="mk-table">
                <thead><tr><th>${t('mkSource')}</th><th>${t('kVisitors')}</th><th>${t('kLeads')}</th><th>${t('kVisits')}</th><th>${t('kBooked')}</th><th>${t('mkSpend')}</th><th>${t('mkPerVisit')}</th></tr></thead>
                <tbody>${list.map(r => `<tr>
                    <td><b>${esc(sourceName(r.source))}</b>${r.campaign ? `<br><small>${esc(r.campaign)}</small>` : ''}</td>
                    <td>${fmt(r.visitors)}</td><td>${fmt(r.leads)}</td><td>${fmt(r.site_visits)}</td><td>${fmt(r.booked)}</td>
                    <td>${r.spend ? money(r.spend) : '—'}</td>
                    <td>${r.spend && r.site_visits ? money(r.spend / r.site_visits) : r.spend && r.leads ? `<small>${t('perLead', { n: money(r.spend / r.leads) })}</small>` : '—'}</td>
                </tr>`).join('')}</tbody></table></div>` : `<p class="help">${t('mkNoData')}</p>`}
            <div class="spend-head">
                <button type="button" class="btn btn-outline btn-sm" data-mk-act="spend-toggle">${ui.spendOpen ? t('close') : t('addSpend')}</button>
                ${data.spend.length ? `<span class="help">${t('spendEntries', { n: data.spend.length })}</span>` : ''}
            </div>
            ${ui.spendOpen ? `<form class="spend-form" id="spend-form">
                <label class="field"><span>${t('mkSource')}</span><select name="source">${SOURCES.map(x => `<option value="${x}">${esc(sourceName(x))}</option>`).join('')}</select></label>
                <label class="field"><span>${t('campaignName')}</span><input name="campaign" maxlength="80" placeholder="${esc(t('campaignHint'))}"></label>
                <label class="field"><span>${t('weekOf')}</span><input name="week" type="date" value="${new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)}" required></label>
                <label class="field"><span>${t('amountInr')}</span><input name="amount" type="number" inputmode="numeric" min="1" step="1" placeholder="5000" required></label>
                <button class="btn btn-primary" type="submit">${t('save')}</button>
                ${data.spend.length ? `<ul class="spend-list">${data.spend.slice(0, 8).map(x => `<li><span>${esc(sourceName(x.source))}${x.campaign ? ` · ${esc(x.campaign)}` : ''} · ${new Date(x.week + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</span><b>${money(x.amount)}</b><button type="button" class="btn btn-ghost btn-sm" data-spend-del="${x.id}" aria-label="${esc(t('delete'))}">✕</button></li>`).join('')}</ul>` : ''}
            </form>` : ''}
        </section>

        <section class="card">
            <h2>${t('linkTitle')}</h2><p class="help">${t('linkHelp')}</p>
            <div class="chips" id="link-sources">${['facebook', 'instagram', 'whatsapp', 'youtube', 'google'].map(x => `<button type="button" class="chip${ui.link.source === x ? ' is-active' : ''}" data-link-source="${x}">${esc(sourceName(x))}</button>`).join('')}</div>
            <div class="share-row">
                <input type="text" id="link-campaign" maxlength="60" placeholder="${esc(t('campaignHint'))}" value="${esc(ui.link.campaign)}">
                <button type="button" class="btn btn-tonal" data-mk-act="copy-link">${t('copyLink')}</button>
            </div>
            <pre class="share-preview mono" id="link-preview">${esc(campaignLink())}</pre>
        </section>

        <section class="card">
            <div class="card-head"><div><h2>${t('adTitle')}</h2><p class="help">${t('adHelp')}</p></div>
                <button type="button" class="btn btn-primary" data-mk-act="ad" ${ui.adLoading ? 'disabled' : ''}>${ui.adLoading ? t('adWriting') : ui.ad ? t('adAgain') : t('adWrite')}</button></div>
            ${ui.ad ? renderAd(ui.ad) : ''}
        </section>

        <section class="card">
            <h2>${t('waTitle')}</h2><p class="help">${t('waHelp')}</p>
            ${data.waThreads.length ? `<ul class="customer-list">${data.waThreads.map(th => `<li>
                <button type="button" class="customer" ${th.lead_id ? `data-open="${th.lead_id}"` : `data-wa-thread="${esc(th.phone)}"`}>
                    <span class="avatar" aria-hidden="true">${esc((th.name || '?').trim()[0].toUpperCase())}</span>
                    <span class="who-text"><b>${esc(th.name || `+91 ${th.phone.slice(0, 5)} ${th.phone.slice(5)}`)}</b>
                        <span>${th.last_direction === 'in' ? '← ' : '→ '}${esc(th.last_text.slice(0, 80))}</span>
                        <span class="small">${ago(th.last_at)}</span></span>
                    ${th.status ? `<span class="stage st-${th.status}">${t(`stage_${th.status}`)}</span>` : ''}
                </button></li>`).join('')}</ul>` : `<p class="help">${t('waNone')}</p>`}
            <h3 class="mt">${t('waTryTitle')}</h3><p class="help">${t('waTryHelp')}</p>
            <div class="chat" id="wa-chat">${ui.chat.map(m => `<div class="msg ${m.direction}">${esc(m.text).replace(/\n/g, '<br>')}</div>`).join('') || `<p class="help">${t('waTryEmpty')}</p>`}</div>
            <form class="ask" id="wa-try-form">
                <input type="text" id="wa-try-input" maxlength="500" placeholder="${esc(t('waTryPlaceholder'))}" autocomplete="off" ${ui.chatBusy ? 'disabled' : ''}>
                <button class="btn btn-primary" type="submit" ${ui.chatBusy ? 'disabled' : ''}>${ui.chatBusy ? '…' : t('send')}</button>
            </form>
        </section>

        <section class="card">
            <h2>${t('setupTitle')}</h2><p class="help">${t('setupHelp')}</p>
            <ul class="setup">
                <li><i class="dot ${s.meta?.pageToken ? 'on' : 'off'}"></i><div><b>${t('setupMeta')}</b><span>${s.meta?.pageToken ? t('connected') : t('setupMetaHow')}</span>
                    <code>${esc(s.meta?.webhookUrl || '')}</code><button type="button" class="btn btn-text btn-sm" data-copy="${esc(s.meta?.webhookUrl || '')}">${t('copy')}</button></div></li>
                <li><i class="dot ${s.whatsapp?.configured ? 'on' : 'off'}"></i><div><b>${t('setupWa')}</b><span>${s.whatsapp?.configured ? t('connected') : t('setupWaHow')}</span>
                    <code>${esc(s.whatsapp?.webhookUrl || '')}</code><button type="button" class="btn btn-text btn-sm" data-copy="${esc(s.whatsapp?.webhookUrl || '')}">${t('copy')}</button></div></li>
                <li><i class="dot ${s.ai ? 'on' : 'off'}"></i><div><b>${t('setupAi')}</b><span>${s.ai ? t('connected') : t('setupAiHow')}</span></div></li>
            </ul>
        </section>`;
    }

    function renderAd(ad) {
        return `<div class="ad-variants">${ad.variants.map((v, i) => `<article class="ad">
            <header><span class="chip">${esc(v.lang)}</span><span class="help">${esc(v.angle)}</span></header>
            <p class="ad-primary">${esc(v.primaryText)}</p>
            <p class="ad-head"><b>${esc(v.headline)}</b><br><small>${esc(v.description)}</small></p>
            <footer><span class="chip">${esc(v.cta)}</span><button type="button" class="btn btn-outline btn-sm" data-copy-ad="${i}">${t('copyAd')}</button></footer>
        </article>`).join('')}</div>
        <div class="ad-meta">
            <p><b>${t('adAudience')}:</b> ${esc(ad.audience.locations.join(', '))} · ${ad.audience.ageMin}–${ad.audience.ageMax} · ${esc(ad.audience.interests.join(', '))}</p>
            <p><b>${t('adBudget')}:</b> ${money(ad.dailyBudgetInr)}/${t('day')} · <b>${t('adTip')}:</b> ${esc(ad.tip)}</p>
            ${ad.ai === false ? `<p class="help">${t('askBasic')}</p>` : ''}
        </div>`;
    }

    function campaignLink() {
        const base = (data.setup?.siteUrl || location.origin) + '/';
        const q = new URLSearchParams({ utm_source: ui.link.source, utm_medium: ui.link.source === 'whatsapp' ? 'message' : 'paid', utm_campaign: (ui.link.campaign || 'launch').trim().toLowerCase().replace(/\s+/g, '-') });
        return `${base}?${q}`;
    }

    function ago(iso) {
        const m = (Date.now() - Date.parse(iso)) / 60000;
        if (m < 2) return t('justNow');
        if (m < 60) return t('minAgo', { n: Math.round(m) });
        if (m < 1440) return t('hrAgo', { n: Math.round(m / 60) });
        return t('dayAgo', { n: Math.round(m / 1440) });
    }

    async function writeAd() {
        ui.adLoading = true; onChange('rerender');
        try {
            const f = stockFacts();
            const avail = f.available;
            ui.ad = await api('/api/admin/ai', { method: 'POST', body: JSON.stringify({ task: 'adcopy', lang: getLang(), facts: {
                siteName: SITE.name, city: 'Jaipur', tagline: SITE.tagline, reraId: SITE.rera || null, available: avail, hold: f.hold, booked: f.booked, sold: f.sold,
                minPriceLakh: f.minPriceLakh, hotPlots: f.hot.slice(0, 3), cornerAvailable: f.cornerAvailable, sizesGaj: f.sizesGaj, siteUrl: campaignLink(),
            } }) });
        } catch (err) { toast(err.message); } finally { ui.adLoading = false; onChange('rerender'); }
    }

    async function tryBot(text) {
        if (!text || ui.chatBusy) return;
        ui.chat.push({ direction: 'in', text });
        ui.chatBusy = true; onChange('rerender');
        try {
            const r = await api('/api/admin/marketing', { method: 'POST', body: JSON.stringify({ action: 'wa-test', phone: TEST_PHONE, text, name: 'Test customer' }) });
            ui.chat.push({ direction: 'out', text: r.reply });
            if (r.lead?.handoff) toast(t('waHandoff'));
        } catch (err) { toast(err.message); } finally { ui.chatBusy = false; await load(); onChange('rerender'); }
    }

    function bind(root) {
        root.addEventListener('click', async (e) => {
            const d = e.target.closest('[data-mk-days]');
            if (d) { data.days = Number(d.dataset.mkDays); await load(); onChange('rerender'); return; }
            const ls = e.target.closest('[data-link-source]');
            if (ls) { ui.link.source = ls.dataset.linkSource; onChange('rerender'); return; }
            const cp = e.target.closest('[data-copy]');
            if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast(t('copied')); } catch { prompt(t('copy'), cp.dataset.copy); } return; }
            const ca = e.target.closest('[data-copy-ad]');
            if (ca) { const v = ui.ad.variants[Number(ca.dataset.copyAd)]; const text = `${v.primaryText}\n\n${v.headline}\n${v.description}\nCTA: ${v.cta}`; try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch { prompt(t('copy'), text); } return; }
            const del = e.target.closest('[data-spend-del]');
            if (del) { try { await api('/api/admin/marketing', { method: 'POST', body: JSON.stringify({ action: 'spend-delete', id: Number(del.dataset.spendDel) }) }); await load(); onChange('rerender'); } catch (err) { toast(err.message); } return; }
            const th = e.target.closest('[data-wa-thread]');
            if (th) { ui.chat = (await api(`/api/admin/marketing?thread=${th.dataset.waThread}`)).messages.map(m => ({ direction: m.direction, text: m.text })); onChange('rerender'); $('wa-chat')?.scrollIntoView({ behavior: 'smooth' }); return; }
            const act = e.target.closest('[data-mk-act]');
            if (!act) return;
            switch (act.dataset.mkAct) {
                case 'spend-toggle': ui.spendOpen = !ui.spendOpen; onChange('rerender'); break;
                case 'copy-link': { const url = campaignLink(); try { await navigator.clipboard.writeText(url); toast(t('linkCopied')); } catch { prompt(t('copyLink'), url); } break; }
                case 'ad': writeAd(); break;
            }
        });
        root.addEventListener('input', (e) => {
            if (e.target.id === 'link-campaign') { ui.link.campaign = e.target.value; $('link-preview').textContent = campaignLink(); }
        });
        root.addEventListener('submit', async (e) => {
            if (e.target.id === 'spend-form') {
                e.preventDefault();
                const f = e.target;
                try {
                    await api('/api/admin/marketing', { method: 'POST', body: JSON.stringify({ action: 'spend', source: f.source.value, campaign: f.campaign.value, week: f.week.value, amount: f.amount.value }) });
                    toast(t('saved')); await load(); onChange('rerender');
                } catch (err) { toast(err.message); }
            }
            if (e.target.id === 'wa-try-form') { e.preventDefault(); const v = $('wa-try-input').value.trim(); $('wa-try-input').value = ''; tryBot(v); }
        });
    }

    return { load, render, bind, set onChange(fn) { onChange = fn; }, get setup() { return data.setup; } };
}
