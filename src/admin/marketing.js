// Ads tab — designed for a builder on a phone, not a marketer: what the ads brought in plain words,
// where customers come from, two big buttons to promote the project, and lead sources to connect.
// Anything technical (links, webhook URLs) lives behind a button in a step-by-step sheet.
import { SITE } from '../shared/site.js';
import { t, getLang, locale, sourceName } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Number(n || 0).toLocaleString(locale());
const money = (n) => `₹${fmt(Math.round(n))}`;
const TEST_PHONE = '9999900000';
const ICONS = {
    facebook: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877f2"/><path d="M13.3 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.2 1.2-1.2h1.2V5.8c-.2 0-1-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.8H9v2.4h1.9v6z" fill="#fff"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="6" fill="#e1306c"/><circle cx="12" cy="12" r="4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.3" fill="#fff"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#25d366"/><path d="M12 5.5a6.5 6.5 0 0 0-5.6 9.8L5.5 18.5l3.3-.9A6.5 6.5 0 1 0 12 5.5zm3.4 9.2c-.1.4-.8.8-1.2.8-.3 0-.7.2-2.2-.5a7.4 7.4 0 0 1-2.9-2.5c-.2-.3-.7-1-.7-1.9s.5-1.3.6-1.5c.2-.2.4-.2.5-.2h.3c.1 0 .3 0 .4.3l.5 1.3c.1.1.1.2 0 .3l-.2.3-.3.3c-.1.1-.2.2 0 .4.1.2.5.8 1.1 1.4.8.7 1.4.9 1.6 1 .2.1.3.1.4 0l.6-.7c.1-.2.3-.1.4-.1l1.2.6c.2.1.3.1.3.2.1.1.1.4 0 .5z" fill="#fff"/></svg>',
    google: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff" stroke="#dadce0"/><path d="M17.6 12.2c0-.4 0-.8-.1-1.2H12v2.3h3.2a2.7 2.7 0 0 1-1.2 1.8v1.5h1.9c1.1-1 1.7-2.6 1.7-4.4z" fill="#4285f4"/><path d="M12 17.8c1.6 0 2.9-.5 3.9-1.4l-1.9-1.5c-.5.4-1.2.6-2 .6-1.5 0-2.8-1-3.3-2.4H6.8v1.5a5.9 5.9 0 0 0 5.2 3.2z" fill="#34a853"/><path d="M8.7 13.1a3.5 3.5 0 0 1 0-2.2V9.4H6.8a5.9 5.9 0 0 0 0 5.2z" fill="#fbbc04"/><path d="M12 8.5c.9 0 1.6.3 2.2.9l1.7-1.7A5.9 5.9 0 0 0 6.8 9.4l1.9 1.5c.5-1.4 1.8-2.4 3.3-2.4z" fill="#ea4335"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" fill="#ff0000"/><path d="M10 9v6l5-3z" fill="#fff"/></svg>',
    other: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#e8eaed"/><path d="M12 7v10M7 12h10" stroke="#5f6368" stroke-width="2" stroke-linecap="round"/></svg>',
    direct: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#e8f0fe"/><path d="M8 12l3 3 5-6" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const iconFor = (s) => ICONS[s] || ICONS.other;

export function createMarketing({ api, toast, stockFacts }) {
    const data = { days: 30, campaigns: [], spend: [], waThreads: [], setup: null, loadedAt: 0 };
    const ui = { sheet: null, link: { source: 'facebook', campaign: '' }, ad: null, adLoading: false, chat: [], chatBusy: false, expanded: null };
    let onChange = () => {};

    async function load(days = data.days) {
        const r = await api(`/api/admin/marketing?days=${days}`);
        Object.assign(data, r, { loadedAt: Date.now() });
    }

    // Totals per source (campaigns folded in), with spend
    function bySource() {
        const out = {};
        data.campaigns.forEach(c => {
            const s = (out[c.source] ??= { source: c.source, visitors: 0, leads: 0, site_visits: 0, booked: 0, spend: 0, campaigns: [] });
            s.visitors += c.visitors; s.leads += c.leads; s.site_visits += c.site_visits; s.booked += c.booked;
            if (c.campaign) s.campaigns.push(c);
        });
        data.spend.forEach(x => { (out[x.source] ??= { source: x.source, visitors: 0, leads: 0, site_visits: 0, booked: 0, spend: 0, campaigns: [] }).spend += x.amount; });
        return Object.values(out).sort((a, b) => b.leads - a.leads || b.visitors - a.visitors);
    }

    function render(el) {
        const sources = bySource();
        const tot = sources.reduce((a, s) => ({ leads: a.leads + s.leads, visits: a.visits + s.site_visits, booked: a.booked + s.booked, spend: a.spend + s.spend }), { leads: 0, visits: 0, booked: 0, spend: 0 });
        const s = data.setup || {};
        const paid = sources.filter(x => !['direct', 'walk_in'].includes(x.source));
        el.innerHTML = `
        <section class="card">
            <div class="card-head"><h2>${t('mkTitle')}</h2>
                <div class="tabs" role="tablist">${[30, 90].map(d => `<button type="button" role="tab" class="${data.days === d ? 'is-active' : ''}" data-mk-days="${d}">${t(`tab${d}`)}</button>`).join('')}</div></div>
            <div class="big-nums">
                <div><b>${fmt(tot.leads)}</b><span>${t('mkCustomers')}</span></div>
                <div><b>${fmt(tot.visits)}</b><span>${t('kVisits')}</span></div>
                <div><b>${fmt(tot.booked)}</b><span>${t('kBooked')}</span></div>
            </div>
            <p class="mk-line">${tot.spend
                ? (tot.visits ? t('mkSpentPerVisit', { spent: money(tot.spend), per: money(tot.spend / tot.visits) }) : t('mkSpentNoVisits', { spent: money(tot.spend) }))
                : t('mkNoSpend')}
                <button type="button" class="link" data-mk-sheet="spend">${tot.spend ? t('addSpend') : t('addSpendFirst')}</button></p>
        </section>

        <section class="card">
            <h2>${t('mkSourcesTitle')}</h2>
            ${paid.length || sources.length ? `<ul class="src-list">${sources.map(x => `<li>
                <button type="button" class="src-row" data-mk-expand="${esc(x.source)}" aria-expanded="${ui.expanded === x.source}">
                    <span class="src-icon">${iconFor(x.source)}</span>
                    <span class="who-text"><b>${esc(sourceName(x.source))}</b>
                        <span>${t('mkRowLine', { leads: fmt(x.leads), visits: fmt(x.site_visits), booked: fmt(x.booked) })}</span>
                        ${x.spend ? `<span class="small">${t('mkSpentLine', { spent: money(x.spend) })}${x.site_visits ? ` · <b>${t('perVisit', { n: money(x.spend / x.site_visits) })}</b>` : x.leads ? ` · ${t('perLead', { n: money(x.spend / x.leads) })}` : ''}</span>` : ''}</span>
                    ${x.campaigns.length ? `<span class="chev">${ui.expanded === x.source ? '▴' : '▾'}</span>` : ''}
                </button>
                ${ui.expanded === x.source && x.campaigns.length ? `<ul class="camp-list">${x.campaigns.map(c => `<li><span>${esc(c.campaign)}</span><span>${t('mkRowLine', { leads: fmt(c.leads), visits: fmt(c.site_visits), booked: fmt(c.booked) })}</span></li>`).join('')}</ul>` : ''}
            </li>`).join('')}</ul>` : `<p class="help">${t('mkNoData')}</p>`}
        </section>

        <section class="card promote">
            <h2>${t('promoteTitle')}</h2><p class="help">${t('promoteHelp')}</p>
            <div class="promote-btns">
                <button type="button" class="btn btn-primary btn-lg" data-mk-sheet="link">🔗 ${t('makeAdLink')}</button>
                <button type="button" class="btn btn-tonal btn-lg" data-mk-sheet="ad">✍️ ${t('getAdText')}</button>
            </div>
        </section>

        <section class="card">
            <h2>${t('sourcesConnectTitle')}</h2><p class="help">${t('sourcesConnectHelp')}</p>
            <ul class="src-list">
                <li><div class="src-row static"><span class="src-icon">${ICONS.facebook}</span><span class="who-text"><b>${t('srcMeta')}</b><span>${s.meta?.pageToken ? `<i class="dot on"></i>${t('connected')}` : t('srcMetaOff')}</span></span>
                    <button type="button" class="btn ${s.meta?.pageToken ? 'btn-outline' : 'btn-primary'} btn-sm" data-mk-sheet="connect-meta">${s.meta?.pageToken ? t('details') : t('connect')}</button></div></li>
                <li><div class="src-row static"><span class="src-icon">${ICONS.whatsapp}</span><span class="who-text"><b>${t('srcWa')}</b><span>${s.whatsapp?.configured ? `<i class="dot on"></i>${t('connected')}` : t('srcWaOff')}</span></span>
                    <button type="button" class="btn ${s.whatsapp?.configured ? 'btn-outline' : 'btn-primary'} btn-sm" data-mk-sheet="connect-wa">${s.whatsapp?.configured ? t('details') : t('connect')}</button></div></li>
                <li><div class="src-row static"><span class="src-icon">✨</span><span class="who-text"><b>${t('setupAi')}</b><span>${s.ai ? `<i class="dot on"></i>${t('aiOn')}` : t('aiOff')}</span></span>
                    <button type="button" class="btn btn-outline btn-sm" data-mk-sheet="try-ai">${t('tryIt')}</button></div></li>
            </ul>
        </section>`;
        if (ui.sheet) renderSheet();
    }

    // ─── Sheets (one dialog, several contents) ───────
    const sheet = () => $('mk-sheet');
    function openSheet(kind) { ui.sheet = kind; renderSheet(); if (!sheet().open) sheet().showModal(); }
    function closeSheet() { ui.sheet = null; if (sheet().open) sheet().close(); }
    const head = (title, help) => `<header class="sheet-head"><div class="who-text"><h2>${title}</h2>${help ? `<span>${help}</span>` : ''}</div>
        <button type="button" class="btn btn-ghost icon-only" data-mk-close aria-label="${esc(t('close'))}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></header>`;
    const copyBtn = (text, label = t('copy')) => `<button type="button" class="btn btn-outline btn-sm" data-copy="${esc(text)}">${label}</button>`;

    function renderSheet() {
        const s = data.setup || {};
        const body = $('mk-sheet-body');
        switch (ui.sheet) {
            case 'link': {
                const url = campaignLink();
                body.innerHTML = `${head(t('makeAdLink'), t('linkHelp'))}
                    <section><h3>${t('linkWhere')}</h3><div class="src-pick">${['facebook', 'instagram', 'whatsapp', 'youtube', 'google'].map(x => `<button type="button" class="src-pick-btn${ui.link.source === x ? ' is-active' : ''}" data-link-source="${x}">${iconFor(x)}<span>${esc(sourceName(x))}</span></button>`).join('')}</div></section>
                    <section><label class="field"><span>${t('campaignName')} <small>(${t('optional')})</small></span><input id="link-campaign" maxlength="60" placeholder="${esc(t('campaignHint'))}" value="${esc(ui.link.campaign)}"></label></section>
                    <section><div class="link-box"><span id="link-preview">${esc(url)}</span></div>
                        <div class="sheet-actions">${copyBtn(url, t('copyLink'))}<a class="btn btn-tonal btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(url)}">${t('shareWhatsApp')}</a></div>
                        <p class="help">${t('linkThen')}</p></section>`;
                break;
            }
            case 'ad':
                body.innerHTML = `${head(t('getAdText'), t('adHelp'))}
                    ${ui.ad ? renderAd(ui.ad) : `<section><p class="help">${t('adIntro')}</p></section>`}
                    <footer class="sheet-foot"><button type="button" class="btn btn-primary btn-lg" data-mk-act="ad" ${ui.adLoading ? 'disabled' : ''}>${ui.adLoading ? t('adWriting') : ui.ad ? t('adAgain') : t('adWrite')}</button></footer>`;
                break;
            case 'spend':
                body.innerHTML = `${head(t('addSpend'), t('spendHelp'))}
                    <form id="spend-form">
                        <section><h3>${t('spendWhere')}</h3><div class="src-pick">${['facebook', 'instagram', 'google', 'youtube', '99acres', 'magicbricks', 'other'].map(x => `<button type="button" class="src-pick-btn${(ui.spendSource || 'facebook') === x ? ' is-active' : ''}" data-spend-source="${x}">${iconFor(x)}<span>${esc(sourceName(x))}</span></button>`).join('')}</div></section>
                        <section><label class="field"><span>${t('amountInr')}</span><div class="price-row"><span class="prefix">₹</span><input name="amount" type="number" inputmode="numeric" min="1" step="1" placeholder="5000" required></div></label></section>
                        <section><h3>${t('spendWhen')}</h3><div class="chips">${[[0, 'thisMonth'], [1, 'lastMonth']].map(([k, key]) => `<button type="button" class="chip${(ui.spendMonth || 0) === k ? ' is-active' : ''}" data-spend-month="${k}">${t(key)}</button>`).join('')}</div></section>
                        ${data.spend.length ? `<section><h3>${t('spendEntriesTitle')}</h3><ul class="spend-list">${data.spend.slice(0, 8).map(x => `<li><span>${esc(sourceName(x.source))}${x.campaign ? ` · ${esc(x.campaign)}` : ''} · ${new Date(x.week + 'T00:00:00').toLocaleDateString(locale(), { month: 'short', year: 'numeric' })}</span><b>${money(x.amount)}</b><button type="button" class="btn btn-ghost btn-sm" data-spend-del="${x.id}" aria-label="${esc(t('delete'))}">✕</button></li>`).join('')}</ul></section>` : ''}
                        <footer class="sheet-foot"><button class="btn btn-primary btn-lg" type="submit">${t('save')}</button></footer>
                    </form>`;
                break;
            case 'connect-meta':
                body.innerHTML = `${head(t('srcMeta'), s.meta?.pageToken ? t('connected') : t('connectMetaWhy'))}
                    <ol class="steps">
                        <li>${t('metaStep1')}</li>
                        <li>${t('metaStep2')}<div class="link-box"><span>${esc(s.meta?.webhookUrl || '')}</span></div>${copyBtn(s.meta?.webhookUrl || '')}</li>
                        <li>${t('metaStep3')}</li>
                    </ol>
                    <p class="help">${t('needDeveloper')}</p>
                    <footer class="sheet-foot"><a class="btn btn-tonal btn-lg" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(devMessage('meta'))}">${t('sendToDeveloper')}</a></footer>`;
                break;
            case 'connect-wa':
                body.innerHTML = `${head(t('srcWa'), s.whatsapp?.configured ? t('connected') : t('connectWaWhy'))}
                    <ol class="steps">
                        <li>${t('waStep1')}</li>
                        <li>${t('waStep2')}<div class="link-box"><span>${esc(s.whatsapp?.webhookUrl || '')}</span></div>${copyBtn(s.whatsapp?.webhookUrl || '')}</li>
                        <li>${t('waStep3')}</li>
                    </ol>
                    <p class="help">${t('needDeveloper')}</p>
                    <footer class="sheet-foot"><a class="btn btn-tonal btn-lg" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(devMessage('wa'))}">${t('sendToDeveloper')}</a></footer>`;
                break;
            case 'try-ai':
                body.innerHTML = `${head(t('waTryTitle'), t('waTryHelp'))}
                    <div class="chat" id="wa-chat">${ui.chat.map(m => `<div class="msg ${m.direction}">${esc(m.text).replace(/\n/g, '<br>')}</div>`).join('') || `<p class="help">${t('waTryEmpty')}</p>`}</div>
                    <form class="ask" id="wa-try-form"><input type="text" id="wa-try-input" maxlength="500" placeholder="${esc(t('waTryPlaceholder'))}" autocomplete="off" ${ui.chatBusy ? 'disabled' : ''}><button class="btn btn-primary" type="submit" ${ui.chatBusy ? 'disabled' : ''}>${ui.chatBusy ? '…' : t('send')}</button></form>
                    ${!s.ai ? `<p class="help">${t('aiOff')}</p>` : ''}`;
                $('wa-chat').scrollTop = 1e6;
                break;
            default: body.innerHTML = '';
        }
    }

    function devMessage(kind) {
        const s = data.setup || {};
        return kind === 'meta'
            ? `Please connect our Facebook/Instagram lead forms to the dashboard.\n1) Meta for Developers → our app → Webhooks → Page → subscribe to "leadgen" with callback URL ${s.meta?.webhookUrl} and a verify token.\n2) Add env vars in Vercel: META_VERIFY_TOKEN (same token), META_PAGE_TOKEN (page access token with leads_retrieval), META_APP_SECRET.\n3) Redeploy.`
            : `Please connect our WhatsApp Business number to the dashboard.\n1) Meta for Developers → WhatsApp → Configuration → webhook callback URL ${s.whatsapp?.webhookUrl}, subscribe to "messages", set a verify token.\n2) Add env vars in Vercel: WA_VERIFY_TOKEN (same token), WA_TOKEN (permanent system-user token), WA_PHONE_ID (phone number ID), WA_APP_SECRET.\n3) Redeploy.`;
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
        const q = new URLSearchParams({ utm_source: ui.link.source, utm_medium: ui.link.source === 'whatsapp' ? 'message' : 'paid', utm_campaign: (ui.link.campaign || 'ad').trim().toLowerCase().replace(/\s+/g, '-') });
        return `${base}?${q}`;
    }

    async function writeAd() {
        ui.adLoading = true; renderSheet();
        try {
            const f = stockFacts();
            ui.ad = await api('/api/admin/ai', { method: 'POST', body: JSON.stringify({ task: 'adcopy', lang: getLang(), facts: {
                siteName: SITE.name, city: 'Jaipur', tagline: SITE.tagline, reraId: SITE.rera || null, available: f.available, hold: f.hold, booked: f.booked, sold: f.sold,
                minPriceLakh: f.minPriceLakh, hotPlots: f.hot.slice(0, 3), cornerAvailable: f.cornerAvailable, sizesGaj: f.sizesGaj, siteUrl: campaignLink(),
            } }) });
        } catch (err) { toast(err.message); } finally { ui.adLoading = false; renderSheet(); }
    }

    async function tryBot(text) {
        if (!text || ui.chatBusy) return;
        ui.chat.push({ direction: 'in', text });
        ui.chatBusy = true; renderSheet();
        try {
            const r = await api('/api/admin/marketing', { method: 'POST', body: JSON.stringify({ action: 'wa-test', phone: TEST_PHONE, text, name: 'Test customer' }) });
            ui.chat.push({ direction: 'out', text: r.reply });
            if (r.lead?.handoff) toast(t('waHandoff'));
        } catch (err) { toast(err.message); } finally { ui.chatBusy = false; renderSheet(); $('wa-try-input')?.focus(); }
    }

    function monthStart(back) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }

    function bind(root) {
        root.addEventListener('click', async (e) => {
            const d = e.target.closest('[data-mk-days]');
            if (d) { data.days = Number(d.dataset.mkDays); await load(); onChange('rerender'); return; }
            const ex = e.target.closest('[data-mk-expand]');
            if (ex) { ui.expanded = ui.expanded === ex.dataset.mkExpand ? null : ex.dataset.mkExpand; onChange('rerender'); return; }
            const sh = e.target.closest('[data-mk-sheet]');
            if (sh) { openSheet(sh.dataset.mkSheet); return; }
        });
        const dlg = sheet();
        dlg.addEventListener('click', async (e) => {
            if (e.target === dlg || e.target.closest('[data-mk-close]')) return closeSheet();
            const ls = e.target.closest('[data-link-source]');
            if (ls) { ui.link.source = ls.dataset.linkSource; renderSheet(); return; }
            const ss = e.target.closest('[data-spend-source]');
            if (ss) { ui.spendSource = ss.dataset.spendSource; renderSheet(); return; }
            const sm = e.target.closest('[data-spend-month]');
            if (sm) { ui.spendMonth = Number(sm.dataset.spendMonth); renderSheet(); return; }
            const cp = e.target.closest('[data-copy]');
            if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast(t('copied')); } catch { prompt(t('copy'), cp.dataset.copy); } return; }
            const ca = e.target.closest('[data-copy-ad]');
            if (ca) { const v = ui.ad.variants[Number(ca.dataset.copyAd)]; const text = `${v.primaryText}\n\n${v.headline}\n${v.description}\nCTA: ${v.cta}`; try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch { prompt(t('copy'), text); } return; }
            const del = e.target.closest('[data-spend-del]');
            if (del) { try { await api('/api/admin/marketing', { method: 'POST', body: JSON.stringify({ action: 'spend-delete', id: Number(del.dataset.spendDel) }) }); await load(); renderSheet(); onChange('rerender'); } catch (err) { toast(err.message); } return; }
            const act = e.target.closest('[data-mk-act]');
            if (act?.dataset.mkAct === 'ad') writeAd();
        });
        dlg.addEventListener('input', (e) => {
            if (e.target.id === 'link-campaign') { ui.link.campaign = e.target.value; const url = campaignLink(); $('link-preview').textContent = url; dlg.querySelector('[data-copy]').dataset.copy = url; dlg.querySelector('a[href^="https://wa.me"]').href = `https://wa.me/?text=${encodeURIComponent(url)}`; }
        });
        dlg.addEventListener('submit', async (e) => {
            if (e.target.id === 'spend-form') {
                e.preventDefault();
                try {
                    await api('/api/admin/marketing', { method: 'POST', body: JSON.stringify({ action: 'spend', source: ui.spendSource || 'facebook', campaign: '', week: monthStart(ui.spendMonth || 0), amount: e.target.amount.value }) });
                    toast(t('saved')); await load(); closeSheet(); onChange('rerender');
                } catch (err) { toast(err.message); }
            }
            if (e.target.id === 'wa-try-form') { e.preventDefault(); const v = $('wa-try-input').value.trim(); tryBot(v); }
        });
        dlg.addEventListener('close', () => { ui.sheet = null; });
    }

    return { load, render, bind, set onChange(fn) { onChange = fn; }, get setup() { return data.setup; } };
}
