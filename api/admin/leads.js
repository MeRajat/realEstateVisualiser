// GET → all leads with engagement; GET ?id=N → that lead's activity timeline;
// PATCH { id, status?, notes?, follow_up? ('YYYY-MM-DD' | null to clear) } → update the lead.
import { getRepo } from '../_lib/db.js';
import { route, send, readJson, badRequest, cleanText } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';

export const LEAD_STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked', 'lost'];

export default route(['GET', 'PATCH'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') {
        const id = Number(new URL(req.url, 'http://x').searchParams.get('id'));
        if (Number.isInteger(id) && id > 0) return send(res, 200, { timeline: await repo.leadTimeline(id) });
        return send(res, 200, { leads: await repo.listLeads() });
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
    const ok = await repo.updateLead(id, {
        status: body.status ?? null,
        notes: body.notes != null ? (cleanText(body.notes, 2000) ?? '') : null,
        followUp,
    });
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'Lead not found' });
});
