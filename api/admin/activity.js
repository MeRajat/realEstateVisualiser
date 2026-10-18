// Lead activity log. POST { leadId, type, outcome?, note?, at? } ; GET ?leadId=N
// Side effects keep the pipeline honest: an answered call moves a new lead to "contacted",
// a scheduled visit sets the visit date, a completed visit moves the lead to "site visit".
import { getRepo } from '../_lib/db.js';
import { route, send, readJson, badRequest, cleanText } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import { ACTIVITY_TYPES, CALL_OUTCOMES, VISIT_OUTCOMES } from '../_lib/crm-repo.js';
import { STAGES } from '../_lib/insights.js';

export default route(['GET', 'POST'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') {
        const id = Number(new URL(req.url, 'http://x').searchParams.get('leadId'));
        if (!Number.isInteger(id) || id < 1) throw badRequest('Invalid lead id');
        return send(res, 200, { activities: await repo.leadActivities(id) });
    }
    const body = await readJson(req);
    const leadId = Number(body.leadId);
    if (!Number.isInteger(leadId) || leadId < 1) throw badRequest('Invalid lead id');
    const type = String(body.type || '');
    if (!ACTIVITY_TYPES.includes(type)) throw badRequest('Unknown activity');
    const outcome = body.outcome == null ? null : String(body.outcome);
    if (type === 'call' && outcome && !CALL_OUTCOMES.includes(outcome)) throw badRequest('Unknown call outcome');
    if (type === 'visit' && !VISIT_OUTCOMES.includes(outcome || '')) throw badRequest('Say whether the visit is scheduled, done, no-show or cancelled');
    let at = null;
    if (body.at) { at = new Date(body.at); if (Number.isNaN(at.getTime())) throw badRequest('Invalid date'); at = at.toISOString(); }
    const lead = (await repo.listLeads()).find(l => l.id === leadId);
    if (!lead) return send(res, 404, { error: 'Lead not found' });

    await repo.addActivity({ leadId, type, outcome, note: cleanText(body.note, 500), actor: cleanText(body.actor, 40) || 'builder', at: type === 'visit' && outcome === 'scheduled' ? null : at });

    const patch = {};
    const idx = STAGES.indexOf(lead.status);
    const forward = (stage) => { if (!['booked', 'lost'].includes(lead.status) && STAGES.indexOf(stage) > idx) patch.status = stage; };
    if (type === 'call' && outcome === 'answered') forward('contacted');
    if (type === 'whatsapp' && lead.status === 'new') patch.notes = undefined; // attempt only; stage unchanged
    if (type === 'visit') {
        if (outcome === 'scheduled') { if (!at) throw badRequest('Pick the visit date and time'); patch.visitAt = at; patch.visitOutcome = 'scheduled'; forward('site_visit'); if (!lead.follow_up) patch.followUp = at.slice(0, 10); }
        if (outcome === 'done') { patch.visitOutcome = 'done'; forward('site_visit'); }
        if (outcome === 'no_show') patch.visitOutcome = 'no_show';
        if (outcome === 'cancelled') patch.visitOutcome = 'cancelled';
    }
    if (type === 'call' && !patch.status && !lead.first_contact_at && outcome === 'answered') patch.status = lead.status;
    if (Object.keys(patch).length) await repo.updateLead(leadId, { status: patch.status ?? null, notes: null, followUp: patch.followUp, visitAt: patch.visitAt, visitOutcome: patch.visitOutcome });
    const updated = (await repo.listLeads()).find(l => l.id === leadId);
    send(res, 200, { ok: true, lead: updated, activities: await repo.leadActivities(leadId) });
});
