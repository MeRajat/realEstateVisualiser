import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, adminCookie } from './helpers.mjs';
import { computeInsights } from '../server/lib/insights.js';

delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.AI_DEV_CLI;
delete process.env.VAPID_PUBLIC_KEY;
const { default: lead } = await import('../server/lead.js');
const { default: leads } = await import('../server/admin/leads.js');
const { default: activity } = await import('../server/admin/activity.js');
const { default: insights } = await import('../server/admin/insights.js');
const { default: settings } = await import('../server/admin/settings.js');
const { default: push } = await import('../server/admin/push.js');
const headers = await adminCookie();
const D = 86400000, H = 3600000;
const now = Date.parse('2026-10-18T06:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

// A believable month: 20 leads, calls slow, lots lost on budget, no-shows at visits
function sampleLeads() {
    const mk = (i, o) => ({ id: i, name: `L${i}`, status: 'new', created_at: iso(now - (i + 1) * D), stage_changed_at: iso(now - (i + 1) * D), first_contact_at: null, lost_from: null, lost_reason: null, visit_at: null, visit_outcome: null, source: 'facebook', assigned_to: null, follow_up: null, ...o });
    return [
        mk(1, { status: 'booked', first_contact_at: iso(now - 2 * D + H), source: 'instagram' }),
        mk(2, { status: 'negotiation', first_contact_at: iso(now - 3 * D + 2 * H), visit_at: iso(now - 1 * D), visit_outcome: 'done', source: 'instagram' }),
        mk(3, { status: 'site_visit', first_contact_at: iso(now - 4 * D + 30 * H), visit_at: iso(now - 2 * D), visit_outcome: 'no_show' }),
        mk(4, { status: 'site_visit', first_contact_at: iso(now - 5 * D + 40 * H), visit_at: iso(now - 1 * D), visit_outcome: 'no_show' }),
        mk(5, { status: 'site_visit', first_contact_at: iso(now - 6 * D + H), visit_at: iso(now - 3 * D), visit_outcome: 'done', source: 'instagram' }),
        mk(6, { status: 'site_visit', first_contact_at: iso(now - 7 * D + H), visit_at: iso(now - 1 * D), visit_outcome: null }),
        mk(7, { status: 'contacted', first_contact_at: iso(now - 8 * D + 50 * H), stage_changed_at: iso(now - 6 * D) }),
        mk(8, { status: 'contacted', first_contact_at: iso(now - 9 * D + 60 * H), stage_changed_at: iso(now - 7 * D) }),
        mk(9, { status: 'contacted', first_contact_at: iso(now - 10 * D + 2 * H), stage_changed_at: iso(now - 9 * D), source: '99acres' }),
        mk(10, { status: 'contacted', first_contact_at: iso(now - 11 * D + 2 * H), stage_changed_at: iso(now - 1 * D), source: '99acres' }),
        mk(11, { status: 'lost', lost_from: 'contacted', lost_reason: 'budget', first_contact_at: iso(now - 12 * D + 70 * H) }),
        mk(12, { status: 'lost', lost_from: 'contacted', lost_reason: 'budget', first_contact_at: iso(now - 13 * D + 80 * H), source: '99acres' }),
        mk(13, { status: 'lost', lost_from: 'site_visit', lost_reason: 'budget', first_contact_at: iso(now - 14 * D + H), visit_at: iso(now - 10 * D), visit_outcome: 'done' }),
        mk(14, { status: 'lost', lost_from: 'new', lost_reason: 'no_response', source: '99acres' }),
        mk(15, { status: 'lost', lost_from: 'contacted', lost_reason: 'location', first_contact_at: iso(now - 16 * D + 90 * H), source: '99acres' }),
        mk(16, { status: 'new', created_at: iso(now - 30 * H), stage_changed_at: iso(now - 30 * H) }),
        mk(17, { status: 'new', created_at: iso(now - 2 * H), stage_changed_at: iso(now - 2 * H) }),
        mk(18, { status: 'new', created_at: iso(now - 3 * D), stage_changed_at: iso(now - 3 * D), follow_up: '2026-10-10' }),
        mk(19, { status: 'contacted', first_contact_at: iso(now - 19 * D + H), stage_changed_at: iso(now - 18 * D), assigned_to: 'Ramesh' }),
        mk(20, { status: 'contacted', first_contact_at: iso(now - 20 * D + 72 * H), stage_changed_at: iso(now - 17 * D), assigned_to: 'Ramesh' }),
    ];
}

test('insights: funnel drop-off, weakest step, speed, lost reasons, no-shows, actions', () => {
    const out = computeInsights({ leads: sampleLeads(), activities: [{ lead_id: 16, type: 'whatsapp', created_at: iso(now - H) }], now, days: 30, minPriceLakh: 35 });
    assert.deepEqual(out.funnel.map(f => f.reached), [20, 16, 7, 2, 1]);
    assert.equal(out.funnel[1].conversion, 44);           // contacted → site visit
    assert.equal(out.funnel[2].conversion, 29);           // site visit → negotiation is the weakest step
    assert.equal(out.weakest.stage, 'site_visit');
    assert.equal(out.funnel[1].stuck, 5);                 // 7, 8, 9, 19, 20 waited > 4 days; 10 moved yesterday
    assert.deepEqual(out.speed.uncontacted.map(u => u.id), [18, 17]); // 16 was messaged on WhatsApp
    assert.equal(out.speed.within24h, 44);
    assert.equal(out.lostReasons[0].reason, 'budget');
    assert.equal(out.lostReasons[0].share, 60);
    assert.equal(out.visits.noShowRate, 40);
    assert.deepEqual(out.visits.pendingOutcome, [6]);
    assert.deepEqual(out.overdue, [18]);
    const ids = out.actions.map(a => a.id);
    assert.ok(ids.includes('uncontacted') && ids.includes('weak-site_visit') && ids.includes('noshow') && ids.includes('lost-budget') && ids.includes('overdue') && ids.includes('visit-outcome'), ids.join(','));
    assert.ok(ids.includes('source'), 'instagram vs 99acres');
    assert.equal(out.actions[0].severity, 'high');
    assert.ok(out.sources.find(s => s.source === 'instagram').visitRate > out.sources.find(s => s.source === '99acres').visitRate);
});

test('insights: empty data gives no actions and no crash', () => {
    const out = computeInsights({ leads: [], activities: [], now, days: 30 });
    assert.equal(out.actions.length, 0);
    assert.equal(out.weakest, null);
});

let leadId;
test('activity log moves the pipeline: answered call → contacted, visit scheduled → site visit, no-show recorded', async () => {
    await call(lead, { method: 'POST', body: { visitorId: 'crm-visitor-000001', name: 'Meena Verma', phone: '9811122233', plotId: '160' } });
    const all = await call(leads, { url: '/api/admin/leads', headers });
    const l = all.json.leads.find(x => x.phone === '9811122233');
    leadId = l.id;
    assert.equal(l.status, 'new');
    assert.equal(l.calls, 0);
    const bad = await call(activity, { method: 'POST', headers, body: { leadId, type: 'call', outcome: 'weird' } });
    assert.equal(bad.status, 400);
    const na = await call(activity, { method: 'POST', headers, body: { leadId, type: 'call', outcome: 'no_answer' } });
    assert.equal(na.status, 200, na.body);
    assert.equal(na.json.lead.status, 'new', 'a missed call is not a conversation');
    const ok = await call(activity, { method: 'POST', headers, body: { leadId, type: 'call', outcome: 'answered', note: 'Wants 200 gaj' } });
    assert.equal(ok.json.lead.status, 'contacted');
    assert.ok(ok.json.lead.first_contact_at);
    const when = new Date(Date.now() + 2 * D).toISOString();
    const vis = await call(activity, { method: 'POST', headers, body: { leadId, type: 'visit', outcome: 'scheduled', at: when } });
    assert.equal(vis.json.lead.status, 'site_visit');
    assert.equal(vis.json.lead.visit_outcome, 'scheduled');
    assert.equal(vis.json.lead.follow_up, when.slice(0, 10));
    const ns = await call(activity, { method: 'POST', headers, body: { leadId, type: 'visit', outcome: 'no_show' } });
    assert.equal(ns.json.lead.visit_outcome, 'no_show');
    const list = await call(leads, { url: '/api/admin/leads', headers });
    const l2 = list.json.leads.find(x => x.id === leadId);
    assert.equal(l2.calls, 2);
    assert.equal(l2.touches, 4);
    const detail = await call(leads, { url: `/api/admin/leads?id=${leadId}`, headers });
    assert.equal(detail.json.activities.length, 4);
});

test('lost reason, assignment and visit date through the lead PATCH', async () => {
    const r = await call(leads, { method: 'PATCH', headers, body: { id: leadId, status: 'lost', lost_reason: 'budget', assigned_to: 'Ramesh' } });
    assert.equal(r.status, 200, r.body);
    const l = (await call(leads, { url: '/api/admin/leads', headers })).json.leads.find(x => x.id === leadId);
    assert.equal(l.lost_reason, 'budget');
    assert.equal(l.lost_from, 'site_visit');
    assert.equal(l.assigned_to, 'Ramesh');
    const bad = await call(leads, { method: 'PATCH', headers, body: { id: leadId, status: 'lost', lost_reason: 'aliens' } });
    assert.equal(bad.status, 400);
    const back = await call(leads, { method: 'PATCH', headers, body: { id: leadId, status: 'contacted' } });
    assert.equal(back.status, 200);
    const l2 = (await call(leads, { url: '/api/admin/leads', headers })).json.leads.find(x => x.id === leadId);
    assert.equal(l2.lost_reason, null);
    const acts = (await call(leads, { url: `/api/admin/leads?id=${leadId}`, headers })).json.activities;
    assert.ok(acts.filter(a => a.type === 'status').length >= 2);
    assert.ok(acts.some(a => a.type === 'assign' && a.outcome === 'Ramesh'));
});

test('insights endpoint runs on live data', async () => {
    const r = await call(insights, { url: '/api/admin/insights?days=30', headers });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.funnel.length, 5);
    assert.ok(Array.isArray(r.json.actions));
});

test('settings: templates and team', async () => {
    const d = await call(settings, { url: '/api/admin/settings', headers });
    assert.ok(d.json.settings.templates.length >= 5);
    const put = await call(settings, { method: 'PUT', headers, body: { team: ['Ramesh', 'Ramesh', ' Suresh '], me: 'Rajat', templates: [{ id: 'first', name: 'Hello', en: 'Hi {name}', hi: '' }] } });
    assert.equal(put.status, 200, put.body);
    assert.deepEqual(put.json.settings.team, ['Ramesh', 'Suresh']);
    assert.equal(put.json.settings.me, 'Rajat');
    assert.equal(put.json.settings.templates.length, 1);
    const empty = await call(settings, { method: 'PUT', headers, body: { templates: [{ id: 'x', name: 'x', en: '', hi: '' }] } });
    assert.equal(empty.status, 400);
});

test('push alerts report "not set up" without keys', async () => {
    const g = await call(push, { url: '/api/admin/push', headers });
    assert.equal(g.json.configured, false);
    const p = await call(push, { method: 'POST', headers, body: { subscription: { endpoint: 'https://x', keys: {} } } });
    assert.equal(p.status, 501);
});

test('router: Vercel rewrite form /api/index?p=<path> reaches the same handler with its query intact', async () => {
    const { route } = await import('../server/router.js');
    const r = await call(route, { url: '/api/index?p=admin/insights&days=7', headers });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.days, 7);
    const s = await call(route, { url: '/api/index?p=webhooks/meta&hub.mode=subscribe&hub.verify_token=meta-verify&hub.challenge=77' });
    assert.ok([200, 403].includes(s.status));
    const nf = await call(route, { url: '/api/index?p=nothing/here' });
    assert.equal(nf.status, 404);
    const plain = await call(route, { url: '/api/admin/settings', headers });
    assert.equal(plain.status, 200);
});
