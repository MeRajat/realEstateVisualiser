// GET → all leads with engagement; GET ?id=N → that lead's activity timeline;
// PATCH { id, status?, notes?, follow_up? ('YYYY-MM-DD' | null to clear) } → update the lead.
import { getRepo } from '../lib/db.js';
import { route, send, readJson, badRequest, cleanText } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { LOST_REASONS } from '../lib/crm-repo.js';

export const LEAD_STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked', 'lost'];

export default route(['GET', 'PATCH'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') {
        const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
        if (Number.isInteger(id) && id > 0) return send(res, 200, { timeline: await repo.leadTimeline(id), activities: await repo.leadActivities(id) });
        // Attach activity counts so the list can show "3 calls · last touch 2 days ago"
        const [leads, acts] = await Promise.all([repo.listLeads(), repo.activitiesSince('1970-01-01T00:00:00Z')]);
        const by = {};
        acts.forEach(a => { const b = (by[a.lead_id] ??= { calls: 0, touches: 0, last: null }); if (a.type === 'call') b.calls += 1; if (a.type !== 'status') b.touches += 1; if (!b.last || a.created_at > b.last) b.last = a.created_at; });
        return send(res, 200, { leads: leads.map(l => ({ ...l, calls: by[l.id]?.calls || 0, touches: by[l.id]?.touches || 0, last_activity_at: by[l.id]?.last || null })) });
    }

    const body = await readJson(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw badRequest('Invalid lead id');
    if (body.status != null && !LEAD_STATUSES.includes(body.status)) throw badRequest('Invalid status');
    let followUp;
    if ('follow_up' in body) {
        if (body.follow_up === null || body.follow_up === '') followUp = null;
        else if (/^\d{4}-\d{2}-\d{2}$/.test(body.follow_up) && !Number.isNaN(Date.parse(body.follow_up))) followUp = body.follow_up;
        else throw badRequest('Invalid follow-up date');
    }
    if (body.lost_reason != null && body.lost_reason !== '' && !LOST_REASONS.includes(body.lost_reason)) throw badRequest('Invalid reason');
    let visitAt;
    if ('visit_at' in body) {
        if (body.visit_at === null || body.visit_at === '') visitAt = null;
        else { const d = new Date(body.visit_at); if (Number.isNaN(d.getTime())) throw badRequest('Invalid visit date'); visitAt = d.toISOString(); }
    }
    const before = body.status != null || 'assigned_to' in body ? (await repo.listLeads()).find(l => l.id === id) : null;
    const ok = await repo.updateLead(id, {
        status: body.status ?? null,
        notes: body.notes != null ? (cleanText(body.notes, 2000) ?? '') : null,
        followUp,
        lostReason: body.lost_reason != null ? (body.lost_reason || null) : undefined,
        assignedTo: 'assigned_to' in body ? (cleanText(body.assigned_to, 40) || null) : undefined,
        visitAt,
        visitOutcome: visitAt === null ? null : undefined,
    });
    if (ok && before && body.status != null && body.status !== before.status) {
        await repo.addActivity({ leadId: id, type: 'status', outcome: body.status, note: body.status === 'lost' ? (body.lost_reason || null) : null, actor: cleanText(body.actor, 40) || 'builder' });
    }
    if (ok && before && 'assigned_to' in body && (cleanText(body.assigned_to, 40) || null) !== (before.assigned_to || null)) {
        await repo.addActivity({ leadId: id, type: 'assign', outcome: cleanText(body.assigned_to, 40) || null, actor: cleanText(body.actor, 40) || 'builder' });
    }
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'Lead not found' });
});
