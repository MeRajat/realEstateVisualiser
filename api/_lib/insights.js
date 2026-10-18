// Where customers drop off, and what to do about it. Pure function over leads + activities so it
// is testable without a database; the AI "coach note" is layered on top in api/admin/insights.js.

export const STAGES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked'];
export const STUCK_DAYS = { new: 1, contacted: 4, site_visit: 7, negotiation: 7 };
const H = 3600000, D = 86400000;

const stageIndex = (s) => STAGES.indexOf(s);
const median = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

export function computeInsights({ leads, activities = [], now = Date.now(), days = 30, minPriceLakh = null, availablePlots = null }) {
    const since = now - days * D;
    const real = leads.filter(l => !l.is_demo || true); // demo rows are fine for a demo account
    const cohort = real.filter(l => Date.parse(l.created_at) >= since);
    const active = real.filter(l => !['booked', 'lost'].includes(l.status));
    const byLead = {};
    activities.forEach(a => { (byLead[a.lead_id] ??= []).push(a); });
    const calls = (l) => (byLead[l.id] || []).filter(a => a.type === 'call');
    const attempts = (l) => (byLead[l.id] || []).filter(a => a.type === 'call' || a.type === 'whatsapp');

    // ── Funnel: how far each customer in the cohort got ──
    const maxStage = (l) => (l.status === 'lost' ? Math.max(0, stageIndex(l.lost_from || 'new')) : stageIndex(l.status));
    const funnel = STAGES.map((stage, i) => {
        const reached = cohort.filter(l => maxStage(l) >= i).length;
        const lostHere = cohort.filter(l => l.status === 'lost' && maxStage(l) === i).length;
        const stuckHere = active.filter(l => l.status === stage && STUCK_DAYS[stage] && now - Date.parse(l.stage_changed_at || l.created_at) > STUCK_DAYS[stage] * D);
        return { stage, reached, lost: lostHere, stuck: stuckHere.length, stuckIds: stuckHere.map(l => l.id), conversion: null };
    });
    for (let i = 0; i < funnel.length - 1; i++) funnel[i].conversion = pct(funnel[i + 1].reached, funnel[i].reached);
    const steps = funnel.slice(0, -1).filter(f => f.reached >= 3);
    const weakest = steps.length ? steps.reduce((w, f) => (f.conversion < w.conversion ? f : w)) : null;

    // ── Speed to first contact ──
    const contacted = real.filter(l => l.first_contact_at && Date.parse(l.created_at) >= since);
    const hours = contacted.map(l => (Date.parse(l.first_contact_at) - Date.parse(l.created_at)) / H);
    const uncontacted = active.filter(l => l.status === 'new' && !attempts(l).length)
        .map(l => ({ id: l.id, name: l.name, hours: Math.round((now - Date.parse(l.created_at)) / H) }))
        .sort((a, b) => b.hours - a.hours);
    const fast = contacted.filter(l => (Date.parse(l.first_contact_at) - Date.parse(l.created_at)) <= 24 * H);
    const slow = contacted.filter(l => (Date.parse(l.first_contact_at) - Date.parse(l.created_at)) > 24 * H);
    const visitRate = (xs) => pct(xs.filter(l => maxStage(l) >= 2).length, xs.length);
    const speed = {
        medianHours: hours.length ? Math.round(median(hours) * 10) / 10 : null,
        within1h: pct(hours.filter(h => h <= 1).length, hours.length),
        within24h: pct(hours.filter(h => h <= 24).length, hours.length),
        uncontacted,
        fastVisitRate: fast.length >= 3 ? visitRate(fast) : null,
        slowVisitRate: slow.length >= 3 ? visitRate(slow) : null,
    };

    // ── Lost reasons ──
    const lost = cohort.filter(l => l.status === 'lost');
    const reasons = {};
    lost.forEach(l => { const r = l.lost_reason || 'other'; reasons[r] = (reasons[r] || 0) + 1; });
    const lostReasons = Object.entries(reasons).map(([reason, n]) => ({ reason, n, share: pct(n, lost.length) })).sort((a, b) => b.n - a.n);

    // ── Site visits ──
    const withVisit = real.filter(l => l.visit_at);
    const past = withVisit.filter(l => Date.parse(l.visit_at) < now);
    const done = past.filter(l => l.visit_outcome === 'done').length;
    const noShow = past.filter(l => l.visit_outcome === 'no_show').length;
    const pendingOutcome = past.filter(l => !l.visit_outcome || l.visit_outcome === 'scheduled').map(l => l.id);
    const upcoming = withVisit.filter(l => Date.parse(l.visit_at) >= now && Date.parse(l.visit_at) < now + 7 * D && l.visit_outcome !== 'cancelled')
        .map(l => ({ id: l.id, name: l.name, at: l.visit_at })).sort((a, b) => a.at.localeCompare(b.at));
    const visits = { done, noShow, noShowRate: pct(noShow, done + noShow), pendingOutcome, upcoming };

    // ── Sources ──
    const bySource = {};
    cohort.forEach(l => {
        const s = (bySource[l.source || 'direct'] ??= { source: l.source || 'direct', leads: 0, visits: 0, booked: 0 });
        s.leads += 1; if (maxStage(l) >= 2) s.visits += 1; if (l.status === 'booked') s.booked += 1;
    });
    const sources = Object.values(bySource).map(s => ({ ...s, visitRate: pct(s.visits, s.leads) })).sort((a, b) => b.leads - a.leads);
    const rated = sources.filter(s => s.leads >= 3 && s.visitRate != null);
    const bestSource = rated.length ? rated.reduce((b, s) => (s.visitRate > b.visitRate ? s : b)) : null;
    const worstSource = rated.length > 1 ? rated.reduce((w, s) => (s.visitRate < w.visitRate ? s : w)) : null;

    // ── Team ──
    const byPerson = {};
    real.filter(l => l.assigned_to && Date.parse(l.created_at) >= since).forEach(l => {
        const p = (byPerson[l.assigned_to] ??= { name: l.assigned_to, leads: 0, fast: 0, visits: 0, booked: 0 });
        p.leads += 1;
        if (l.first_contact_at && Date.parse(l.first_contact_at) - Date.parse(l.created_at) <= 24 * H) p.fast += 1;
        if (maxStage(l) >= 2) p.visits += 1; if (l.status === 'booked') p.booked += 1;
    });
    const team = Object.values(byPerson).map(p => ({ ...p, fastRate: pct(p.fast, p.leads) })).sort((a, b) => b.leads - a.leads);

    const overdue = active.filter(l => l.follow_up && Date.parse(l.follow_up + 'T23:59:59+05:30') < now).map(l => l.id);
    const noCallAfter2d = active.filter(l => now - Date.parse(l.created_at) > 2 * D && !calls(l).length && l.status !== 'new').length;

    // ── Action items (ordered by what loses the most money) ──
    const actions = [];
    if (uncontacted.length) {
        const old = uncontacted.filter(u => u.hours >= 24).length;
        actions.push({ id: 'uncontacted', severity: old ? 'high' : 'medium', n: uncontacted.length,
            key: 'actUncontacted', vars: { n: uncontacted.length, old, hours: uncontacted[0].hours },
            action: { kind: 'list', filter: { stage: 'new', untouched: true }, template: 'first' } });
    }
    if (weakest && weakest.conversion != null && weakest.conversion < 50) {
        const next = STAGES[stageIndex(weakest.stage) + 1];
        actions.push({ id: `weak-${weakest.stage}`, severity: 'high', n: weakest.reached - funnel[stageIndex(next)].reached,
            key: 'actWeakStep', vars: { from: weakest.stage, to: next, pct: weakest.conversion, n: weakest.reached },
            action: { kind: 'list', filter: { stage: weakest.stage }, template: weakest.stage === 'contacted' ? 'visit' : weakest.stage === 'site_visit' ? 'after' : 'nudge' } });
    }
    funnel.filter(f => f.stuck >= 2).forEach(f => actions.push({ id: `stuck-${f.stage}`, severity: 'medium', n: f.stuck,
        key: 'actStuck', vars: { n: f.stuck, stage: f.stage, days: STUCK_DAYS[f.stage] },
        action: { kind: 'list', filter: { stage: f.stage, stuck: true }, template: 'nudge' } }));
    if (visits.noShowRate != null && visits.noShowRate >= 30 && done + noShow >= 3) actions.push({ id: 'noshow', severity: 'high', n: noShow,
        key: 'actNoShow', vars: { n: noShow, total: done + noShow, pct: visits.noShowRate },
        action: { kind: 'list', filter: { upcomingVisit: true }, template: 'reminder' } });
    if (pendingOutcome.length) actions.push({ id: 'visit-outcome', severity: 'low', n: pendingOutcome.length,
        key: 'actVisitOutcome', vars: { n: pendingOutcome.length }, action: { kind: 'list', filter: { visitPending: true } } });
    if (lostReasons[0] && lost.length >= 3 && lostReasons[0].share >= 35) {
        const r = lostReasons[0];
        actions.push({ id: `lost-${r.reason}`, severity: 'medium', n: r.n,
            key: `actLost_${r.reason}`, vars: { n: r.n, total: lost.length, pct: r.share, minPrice: minPriceLakh, plots: availablePlots },
            action: r.reason === 'budget' || r.reason === 'size' ? { kind: 'tab', tab: 'stock' } : { kind: 'list', filter: { stage: 'lost' } } });
    }
    if (bestSource && worstSource && bestSource !== worstSource && bestSource.visitRate - worstSource.visitRate >= 15) actions.push({ id: 'source', severity: 'medium', n: worstSource.leads,
        key: 'actSource', vars: { best: bestSource.source, bestPct: bestSource.visitRate, worst: worstSource.source, worstPct: worstSource.visitRate },
        action: { kind: 'tab', tab: 'marketing' } });
    if (speed.fastVisitRate != null && speed.slowVisitRate != null && speed.fastVisitRate - speed.slowVisitRate >= 10) actions.push({ id: 'speed', severity: 'medium', n: slow.length,
        key: 'actSpeed', vars: { fast: speed.fastVisitRate, slow: speed.slowVisitRate, within24h: speed.within24h }, action: { kind: 'list', filter: { stage: 'new' } } });
    if (overdue.length) actions.push({ id: 'overdue', severity: 'medium', n: overdue.length, key: 'actOverdue', vars: { n: overdue.length }, action: { kind: 'list', filter: { overdue: true } } });
    team.filter(p => p.leads >= 5 && p.fastRate != null && p.fastRate < 50).forEach(p => actions.push({ id: `team-${p.name}`, severity: 'low', n: p.leads - p.fast,
        key: 'actTeam', vars: { name: p.name, pct: p.fastRate }, action: { kind: 'list', filter: { assigned: p.name } } }));
    const order = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) => order[a.severity] - order[b.severity] || b.n - a.n);

    return {
        days, cohort: cohort.length, active: active.length,
        funnel: funnel.map(({ stuckIds, ...f }) => f), stuckIds: Object.fromEntries(funnel.map(f => [f.stage, f.stuckIds])),
        weakest: weakest ? { stage: weakest.stage, conversion: weakest.conversion } : null,
        speed, lostReasons, visits, sources, team, overdue, noCallAfter2d, actions,
    };
}
