// CRM pieces: the drop-off pipeline, action items, message templates and phone alerts.
import { SITE } from '../shared/site.js';
import { t, getLang, locale } from './i18n.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmt = (n) => Number(n || 0).toLocaleString(locale());
export const PIPE = ['new', 'contacted', 'site_visit', 'negotiation', 'booked'];
export const LOST_REASONS = ['budget', 'location', 'size', 'wants_ready', 'bought_elsewhere', 'no_response', 'loan', 'timing', 'other'];

// ─── Message templates ───────────────────────────────
export function fillTemplate(tpl, lead, settings = {}) {
    const text = (getLang() === 'hi' && tpl.hi) ? tpl.hi : (tpl.en || tpl.hi || '');
    const first = String(lead.name || '').trim().split(' ')[0] || (getLang() === 'hi' ? 'जी' : 'there');
    const plot = lead.interested_plot;
    const link = `${location.origin}/${plot && !/^[A-Z]-\d+/.test(plot) ? `#plot-${encodeURIComponent(plot)}` : ''}`;
    const plotLine = plot ? (getLang() === 'hi' ? `आपने प्लॉट ${plot} के बारे में पूछा था। ` : `You asked about Plot ${plot}. `) : '';
    return text.replace(/\{name\}/g, first).replace(/\{site\}/g, SITE.name).replace(/\{me\}/g, settings.me || (getLang() === 'hi' ? 'सेल्स टीम' : 'the sales team'))
        .replace(/\{plot_line\}/g, plotLine).replace(/\{link\}/g, link).replace(/\{plot\}/g, plot || '');
}
export const waUrl = (lead, text) => `https://wa.me/91${lead.phone}?text=${encodeURIComponent(text)}`;

// ─── Pipeline card ───────────────────────────────────
export function renderPipeline(ins) {
    if (!ins) return '';
    const f = ins.funnel;
    const weak = ins.weakest?.stage;
    const steps = f.map((s, i) => {
        const next = f[i + 1];
        const isWeak = s.stage === weak;
        return `<div class="pipe-step${isWeak ? ' is-weak' : ''}">
            <div class="pipe-box"><b>${fmt(s.reached)}</b><span>${t(`stage_${s.stage}`)}</span>
                ${s.stuck ? `<small class="pipe-stuck" data-list-filter='${JSON.stringify({ stage: s.stage, stuck: true })}'>⏳ ${t('stuckN', { n: s.stuck })}</small>` : ''}
                ${s.lost ? `<small class="pipe-lost" data-list-filter='${JSON.stringify({ stage: 'lost', lostFrom: s.stage })}'>✕ ${t('lostN', { n: s.lost })}</small>` : ''}</div>
            ${next ? `<div class="pipe-arrow${isWeak ? ' is-weak' : ''}"><span>${s.conversion == null ? '–' : `${s.conversion}%`}</span><i>→</i></div>` : ''}
        </div>`;
    }).join('');
    const sp = ins.speed;
    const facts = [
        sp.medianHours != null ? t('speedFact', { h: sp.medianHours, pct: sp.within24h }) : null,
        ins.visits.noShowRate != null ? t('noShowFact', { pct: ins.visits.noShowRate, n: ins.visits.noShow }) : null,
        sp.fastVisitRate != null && sp.slowVisitRate != null ? t('fastSlowFact', { fast: sp.fastVisitRate, slow: sp.slowVisitRate }) : null,
    ].filter(Boolean);
    return `<section class="card">
        <div class="card-head"><div><h2>${t('pipelineTitle')}</h2><p class="help">${t('pipelineHelp', { days: ins.days, n: ins.cohort })}</p></div></div>
        <div class="pipe">${steps}</div>
        ${weak && ins.weakest.conversion != null ? `<p class="pipe-weak-note">${t('weakestNote', { from: t(`stage_${weak}`), to: t(`stage_${PIPE[PIPE.indexOf(weak) + 1]}`), pct: ins.weakest.conversion })}</p>` : ''}
        ${facts.length ? `<ul class="facts-list">${facts.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
        ${ins.lostReasons.length ? `<h3 class="mt">${t('lostWhy')}</h3><ul class="bars">${ins.lostReasons.map(r => `<li>
            <span class="bar-label">${t(`lost_${r.reason}`)}</span><span class="bar-track"><i style="width:${Math.max(3, r.share)}%"></i></span><span class="bar-value">${r.n} · ${r.share}%</span></li>`).join('')}</ul>` : ''}
    </section>`;
}

// ─── Action items ────────────────────────────────────
export function renderActions(ins, { limit = 99, title = t('actionsTitle') } = {}) {
    if (!ins) return '';
    const list = ins.actions.slice(0, limit);
    return `<section class="card actions-card">
        <div class="card-head"><div><h2>${title}</h2><p class="help">${t('actionsHelp')}</p></div></div>
        ${ins.coach ? `<div class="coach">✨ ${esc(ins.coach).replace(/\n/g, '<br>')}</div>` : ''}
        ${list.length ? `<ul class="actions">${list.map(a => {
            const vars = Object.fromEntries(Object.entries(a.vars || {}).map(([k, v]) => [k, PIPE.includes(v) || v === 'lost' ? t(`stage_${v}`) : esc(v)]));
            if (a.vars?.hours != null) vars.wait = a.vars.hours >= 48 ? t('daysN', { n: Math.round(a.vars.hours / 24) }) : t('hoursN', { n: a.vars.hours });
            vars.minPrice = a.vars?.minPrice ? t('fromPrice', { n: a.vars.minPrice }) : '';
            const text = t(a.key, vars);
            const act = a.action || {};
            const btn = act.kind === 'tab' ? `<button type="button" class="btn btn-tonal btn-sm" data-go-tab="${act.tab}">${t(act.tab === 'stock' ? 'tabStock' : 'tabMarketing')} →</button>`
                : `<button type="button" class="btn btn-tonal btn-sm" data-list-filter='${JSON.stringify(act.filter || {})}' ${act.template ? `data-template="${act.template}"` : ''}>${act.template ? t('seeAndMessage') : t('seeList')} →</button>`;
            return `<li class="action sev-${a.severity}"><i class="sev-dot"></i><div><p>${text}</p>${btn}</div></li>`;
        }).join('')}</ul>` : `<p class="all-done">✓ ${t('actionsNone')}</p>`}
    </section>`;
}

// Filter helpers shared with the list
export function describeFilter(f) {
    const parts = [];
    if (f.stage) parts.push(t(`stage_${f.stage}`));
    if (f.lostFrom) parts.push(t('lostFromX', { stage: t(`stage_${f.lostFrom}`) }));
    if (f.stuck) parts.push(t('fStuck'));
    if (f.untouched) parts.push(t('fUntouched'));
    if (f.overdue) parts.push(t('fOverdue'));
    if (f.upcomingVisit) parts.push(t('fUpcoming'));
    if (f.visitPending) parts.push(t('fVisitPending'));
    if (f.assigned) parts.push(f.assigned);
    return parts.join(' · ');
}

export function matchesListFilter(l, f, ins, now = Date.now()) {
    const D = 864e5;
    if (f.stage && l.status !== f.stage) return false;
    if (f.lostFrom && l.lost_from !== f.lostFrom) return false;
    if (f.stuck && !(ins?.stuckIds?.[l.status] || []).includes(l.id)) return false;
    if (f.untouched && !(l.status === 'new' && !l.touches)) return false;
    if (f.overdue && !(l.follow_up && !['booked', 'lost'].includes(l.status) && Date.parse(l.follow_up + 'T23:59:59+05:30') < now)) return false;
    if (f.upcomingVisit && !(l.visit_at && Date.parse(l.visit_at) >= now && Date.parse(l.visit_at) < now + 7 * D && l.visit_outcome !== 'cancelled')) return false;
    if (f.visitPending && !(l.visit_at && Date.parse(l.visit_at) < now && (!l.visit_outcome || l.visit_outcome === 'scheduled'))) return false;
    if (f.assigned && l.assigned_to !== f.assigned) return false;
    return true;
}

// ─── Phone alerts (Web Push) ─────────────────────────
export async function enableAlerts(api) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(t('alertsUnsupported'));
    const info = await api('/api/admin/push');
    if (!info.configured) throw new Error(t('alertsNotSetUp'));
    const reg = await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(t('alertsDenied'));
    const key = Uint8Array.from(atob(info.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('/api/admin/push', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 60) }) });
    return true;
}
